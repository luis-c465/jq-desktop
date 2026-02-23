use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, watch, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Instant};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const DIAGNOSTIC_WAIT_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDiagnostic {
    pub range: LspRange,
    pub message: String,
    pub severity: Option<u32>,
    pub code: Option<Value>,
    pub source: Option<String>,
}

#[derive(Debug, Clone)]
struct DiagnosticsEvent {
    uri: String,
    diagnostics: Vec<LspDiagnostic>,
    version: u64,
}

impl Default for DiagnosticsEvent {
    fn default() -> Self {
        Self {
            uri: String::new(),
            diagnostics: Vec::new(),
            version: 0,
        }
    }
}

#[derive(Clone)]
pub struct LspClient {
    stdin: Arc<Mutex<BufWriter<ChildStdin>>>,
    child: Arc<Mutex<Child>>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_request_id: Arc<AtomicU64>,
    diagnostics_cache: Arc<Mutex<HashMap<String, Vec<LspDiagnostic>>>>,
    diagnostics_version: Arc<AtomicU64>,
    diagnostics_tx: watch::Sender<DiagnosticsEvent>,
    opened_documents: Arc<Mutex<HashSet<String>>>,
    document_versions: Arc<Mutex<HashMap<String, i32>>>,
    reader_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl LspClient {
    pub async fn start(app_handle: &AppHandle) -> Result<Self, String> {
        let sidecar_path = resolve_sidecar_path(app_handle)?;

        let mut child = Command::new(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start jq-lsp sidecar: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture jq-lsp stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture jq-lsp stdout".to_string())?;

        let pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let diagnostics_cache = Arc::new(Mutex::new(HashMap::new()));
        let diagnostics_version = Arc::new(AtomicU64::new(0));
        let (diagnostics_tx, _) = watch::channel(DiagnosticsEvent::default());

        let reader_pending = Arc::clone(&pending_requests);
        let reader_diagnostics = Arc::clone(&diagnostics_cache);
        let reader_diagnostics_version = Arc::clone(&diagnostics_version);
        let reader_diagnostics_tx = diagnostics_tx.clone();

        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);

            loop {
                let message = match read_message(&mut reader).await {
                    Ok(Some(message)) => message,
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("jq-lsp read error: {error}");
                        break;
                    }
                };

                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    let mut pending = reader_pending.lock().await;
                    if let Some(sender) = pending.remove(&id) {
                        let _ = sender.send(message);
                    }
                    continue;
                }

                let method = message.get("method").and_then(Value::as_str);
                if method != Some("textDocument/publishDiagnostics") {
                    continue;
                }

                let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
                let uri = params
                    .get("uri")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();

                let diagnostics = serde_json::from_value::<Vec<LspDiagnostic>>(
                    params
                        .get("diagnostics")
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                )
                .unwrap_or_default();

                {
                    let mut cache = reader_diagnostics.lock().await;
                    cache.insert(uri.clone(), diagnostics.clone());
                }

                let version = reader_diagnostics_version.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = reader_diagnostics_tx.send(DiagnosticsEvent {
                    uri,
                    diagnostics,
                    version,
                });
            }
        });

        let client = Self {
            stdin: Arc::new(Mutex::new(BufWriter::new(stdin))),
            child: Arc::new(Mutex::new(child)),
            pending_requests,
            next_request_id: Arc::new(AtomicU64::new(1)),
            diagnostics_cache,
            diagnostics_version,
            diagnostics_tx,
            opened_documents: Arc::new(Mutex::new(HashSet::new())),
            document_versions: Arc::new(Mutex::new(HashMap::new())),
            reader_task: Arc::new(Mutex::new(Some(reader_task))),
        };

        client
            .request(
                "initialize",
                json!({
                    "processId": null,
                    "rootUri": "file:///",
                    "capabilities": {}
                }),
            )
            .await?;
        client.notify("initialized", json!({})).await?;

        Ok(client)
    }

    pub async fn did_change(&self, uri: String, text: String) -> Result<Vec<LspDiagnostic>, String> {
        if text.trim().is_empty() {
            let mut cache = self.diagnostics_cache.lock().await;
            cache.insert(uri, Vec::new());
            return Ok(Vec::new());
        }

        let started_version = self.diagnostics_version.load(Ordering::SeqCst);
        self.open_or_change_document(&uri, &text).await?;

        let mut receiver = self.diagnostics_tx.subscribe();
        let deadline = Instant::now() + DIAGNOSTIC_WAIT_TIMEOUT;

        while Instant::now() < deadline {
            let wait_for_update = deadline.saturating_duration_since(Instant::now());
            if wait_for_update.is_zero() {
                break;
            }

            match timeout(wait_for_update, receiver.changed()).await {
                Ok(Ok(())) => {
                    let event = receiver.borrow().clone();
                    if event.version > started_version && event.uri == uri {
                        return Ok(event.diagnostics);
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => break,
            }
        }

        sleep(Duration::from_millis(20)).await;
        self.diagnostics_for_uri(&uri).await
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id, sender);
        }

        if let Err(error) = self.write_message(&request).await {
            let mut pending = self.pending_requests.lock().await;
            pending.remove(&id);
            return Err(error);
        }

        let response = timeout(REQUEST_TIMEOUT, receiver)
            .await
            .map_err(|_| format!("LSP request timed out: {method}"))
            .and_then(|result| {
                result.map_err(|_| format!("LSP request channel closed: {method}"))
            })?;

        if let Some(error) = response.get("error") {
            return Err(format!("LSP request failed: {error}"));
        }

        Ok(response
            .get("result")
            .cloned()
            .unwrap_or_else(|| Value::Null))
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.write_message(&notification).await
    }

    pub async fn diagnostics_for_uri(&self, uri: &str) -> Result<Vec<LspDiagnostic>, String> {
        let cache = self.diagnostics_cache.lock().await;
        Ok(cache.get(uri).cloned().unwrap_or_default())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        let _ = self.request("shutdown", json!(null)).await;
        let _ = self.notify("exit", json!(null)).await;

        {
            let mut child = self.child.lock().await;
            match timeout(Duration::from_secs(2), child.wait()).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => {
                    return Err(format!("Failed waiting for jq-lsp shutdown: {error}"));
                }
                Err(_) => {
                    child
                        .kill()
                        .await
                        .map_err(|error| format!("Failed to kill jq-lsp process: {error}"))?;
                }
            }
        }

        if let Some(handle) = self.reader_task.lock().await.take() {
            handle.abort();
        }

        Ok(())
    }

    async fn open_or_change_document(&self, uri: &str, text: &str) -> Result<(), String> {
        let mut opened = self.opened_documents.lock().await;
        let mut versions = self.document_versions.lock().await;

        if !opened.contains(uri) {
            opened.insert(uri.to_string());
            versions.insert(uri.to_string(), 1);

            self.notify(
                "textDocument/didOpen",
                json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": "jq",
                        "version": 1,
                        "text": text
                    }
                }),
            )
            .await?;

            return Ok(());
        }

        let next_version = versions.get(uri).copied().unwrap_or(1) + 1;
        versions.insert(uri.to_string(), next_version);

        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": {
                    "uri": uri,
                    "version": next_version
                },
                "contentChanges": [
                    {
                        "text": text
                    }
                ]
            }),
        )
        .await
    }

    async fn write_message(&self, value: &Value) -> Result<(), String> {
        let message = encode_message(value)?;
        let mut writer = self.stdin.lock().await;
        writer
            .write_all(&message)
            .await
            .map_err(|error| format!("Failed writing LSP message: {error}"))?;
        writer
            .flush()
            .await
            .map_err(|error| format!("Failed flushing LSP message: {error}"))
    }
}

fn resolve_sidecar_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let triple = current_target_triple();
    let binary_name = if cfg!(target_os = "windows") {
        format!("jq-lsp-{triple}.exe")
    } else {
        format!("jq-lsp-{triple}")
    };

    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(&binary_name));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(&binary_name));
            candidates.push(exe_dir.join("binaries").join(&binary_name));
            candidates.push(exe_dir.join("../Resources/binaries").join(&binary_name));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("src-tauri/binaries").join(&binary_name));
        candidates.push(current_dir.join("binaries").join(&binary_name));
    }

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find jq-lsp sidecar binary '{binary_name}'. Run `bun run build:sidecar` first."
    ))
}

fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        "x86_64-unknown-linux-gnu"
    }
}

fn encode_message(value: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value)
        .map_err(|error| format!("Failed serializing LSP message: {error}"))?;
    let mut message = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    message.extend_from_slice(&body);
    Ok(message)
}

async fn read_message(reader: &mut BufReader<tokio::process::ChildStdout>) -> Result<Option<Value>, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut header_line = String::new();
        let bytes_read = reader
            .read_line(&mut header_line)
            .await
            .map_err(|error| format!("Failed reading LSP headers: {error}"))?;

        if bytes_read == 0 {
            return Ok(None);
        }

        let trimmed = header_line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = Some(value.trim().parse::<usize>().map_err(|error| {
                    format!("Invalid Content-Length value '{value}': {error}")
                })?);
            }
        }
    }

    let length = content_length.ok_or_else(|| "LSP message missing Content-Length header".to_string())?;
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|error| format!("Failed reading LSP body: {error}"))?;

    let message: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Failed parsing LSP JSON: {error}"))?;
    Ok(Some(message))
}

#[cfg(test)]
mod tests {
    use super::encode_message;
    use serde_json::json;

    #[test]
    fn encode_message_sets_content_length() {
        let message = encode_message(&json!({"jsonrpc": "2.0", "method": "ping"}))
            .expect("message should encode");
        let encoded = String::from_utf8(message).expect("encoded message should be valid UTF-8");

        assert!(encoded.starts_with("Content-Length: "));
        assert!(encoded.contains("\r\n\r\n"));
    }
}
