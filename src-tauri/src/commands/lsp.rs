use crate::lsp_client::{LspClient, LspDiagnostic};
use crate::state::AppState;
use serde_json::{json, Value};

#[tauri::command]
pub async fn lsp_initialize(state: tauri::State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let mut client = state.lsp_client.lock().await;

    if client.is_some() {
        return Ok(());
    }

    *client = Some(LspClient::start(&app).await?);
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_change(
    uri: String,
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<LspDiagnostic>, String> {
    let client = get_or_init_client(&state).await?;
    client.did_change(uri, text).await
}

#[tauri::command]
pub async fn lsp_hover(
    uri: String,
    line: u32,
    character: u32,
    state: tauri::State<'_, AppState>,
) -> Result<Option<Value>, String> {
    let client = get_or_init_client(&state).await?;
    let result = client
        .request(
            "textDocument/hover",
            json!({
                "textDocument": { "uri": uri },
                "position": {
                    "line": line,
                    "character": character
                }
            }),
        )
        .await?;

    if result.is_null() {
        Ok(None)
    } else {
        Ok(Some(result))
    }
}

#[tauri::command]
pub async fn lsp_complete(
    uri: String,
    line: u32,
    character: u32,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    let client = get_or_init_client(&state).await?;
    let result = client
        .request(
            "textDocument/completion",
            json!({
                "textDocument": { "uri": uri },
                "position": {
                    "line": line,
                    "character": character
                }
            }),
        )
        .await?;

    if let Some(items) = result.get("items").and_then(Value::as_array) {
        return Ok(items.clone());
    }

    if let Some(items) = result.as_array() {
        return Ok(items.clone());
    }

    Ok(Vec::new())
}

#[tauri::command]
pub async fn lsp_shutdown(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.lsp_client.lock().await;
    if let Some(existing) = client.take() {
        existing.shutdown().await?;
    }
    Ok(())
}

async fn get_or_init_client(state: &tauri::State<'_, AppState>) -> Result<LspClient, String> {
    let client = state.lsp_client.lock().await;
    client
        .as_ref()
        .cloned()
        .ok_or_else(|| "LSP client not initialized. Call lsp_initialize first.".to_string())
}
