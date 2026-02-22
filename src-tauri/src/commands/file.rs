use crate::error::AppError;
use crate::json_store::TreeNodeInfo;
use crate::state::AppState;
use serde::Serialize;
use std::path::Path;
use tauri::ipc::Channel;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const MAX_FILE_SIZE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const READ_CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_EMIT_EVERY_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum LoadProgress {
    Reading { bytes_read: u64, total_bytes: u64 },
    Parsing,
    Complete {
        root_nodes: Vec<TreeNodeInfo>,
        file_name: String,
        file_size: u64,
    },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub loaded: bool,
    pub file_name: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
}

#[tauri::command]
pub async fn load_file(
    path: String,
    on_progress: Channel<LoadProgress>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let result = load_file_impl(&path, &on_progress, &state).await;

    if let Err(error) = result {
        let message = error.to_string();
        let _ = on_progress.send(LoadProgress::Error {
            message: message.clone(),
        });
        return Err(message);
    }

    Ok(())
}

#[tauri::command]
pub fn close_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut store = state
        .json_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;
    store.clear();
    Ok(())
}

#[tauri::command]
pub fn get_file_info(state: tauri::State<'_, AppState>) -> Result<FileInfo, String> {
    let store = state
        .json_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;

    Ok(FileInfo {
        loaded: store.data.is_some(),
        file_name: store
            .file_path
            .as_deref()
            .map(extract_file_name)
            .map(ToOwned::to_owned),
        file_path: store.file_path.clone(),
        file_size: store.file_size,
    })
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(path).map_err(|error| AppError::from(error).to_string())?;
    Ok(metadata.len())
}

async fn load_file_impl(
    path: &str,
    on_progress: &Channel<LoadProgress>,
    state: &tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let metadata = tokio::fs::metadata(path).await?;
    let file_size = metadata.len();

    if file_size > MAX_FILE_SIZE_BYTES {
        return Err(AppError::FileTooLarge(file_size));
    }

    let mut file = File::open(path).await?;
    let mut bytes = Vec::with_capacity(file_size.min(usize::MAX as u64) as usize);
    let mut chunk = vec![0_u8; READ_CHUNK_SIZE];
    let mut bytes_read: u64 = 0;
    let mut last_emit = 0;

    loop {
        let read_count = file.read(&mut chunk).await?;
        if read_count == 0 {
            break;
        }

        bytes.extend_from_slice(&chunk[..read_count]);
        bytes_read += read_count as u64;

        let should_emit = bytes_read == file_size || bytes_read.saturating_sub(last_emit) >= PROGRESS_EMIT_EVERY_BYTES;
        if should_emit {
            last_emit = bytes_read;
            let _ = on_progress.send(LoadProgress::Reading {
                bytes_read,
                total_bytes: file_size,
            });
        }
    }

    let _ = on_progress.send(LoadProgress::Parsing);

    let parsed: serde_json::Value = serde_json::from_slice(&bytes)?;

    let root_nodes = {
        let mut store = state
            .json_store
            .lock()
            .map_err(|_| AppError::ParseError("Failed to acquire application state lock".to_string()))?;
        store.data = Some(parsed);
        store.file_path = Some(path.to_string());
        store.file_size = Some(file_size);
        store.get_root_nodes()?
    };

    let _ = on_progress.send(LoadProgress::Complete {
        root_nodes,
        file_name: extract_file_name(path).to_string(),
        file_size,
    });

    Ok(())
}

fn extract_file_name(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::extract_file_name;

    #[test]
    fn extract_file_name_uses_last_segment() {
        assert_eq!(extract_file_name("/tmp/data.json"), "data.json");
        assert_eq!(extract_file_name("relative/path/a.json"), "a.json");
    }

    #[test]
    fn extract_file_name_falls_back_to_input() {
        assert_eq!(extract_file_name(""), "");
        assert_eq!(extract_file_name("just-a-name.json"), "just-a-name.json");
    }
}
