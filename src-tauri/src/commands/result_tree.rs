use crate::state::AppState;
use crate::tree_nav::{truncate_utf8_bytes, ExpandResult};

const DEFAULT_EXPAND_OFFSET: usize = 0;
const DEFAULT_EXPAND_LIMIT: usize = 500;
const MAX_NODE_VALUE_BYTES: usize = 1024 * 1024;

#[tauri::command]
pub fn expand_result_node(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<ExpandResult, String> {
    let offset = offset.unwrap_or(DEFAULT_EXPAND_OFFSET);
    let limit = limit.unwrap_or(DEFAULT_EXPAND_LIMIT);

    let store = state
        .result_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;

    let (children, total_children) = if path == "$result" {
        store.get_result_root_nodes(offset, limit)
    } else {
        store
            .get_children(&path, offset, limit)
            .map_err(|error| error.to_string())?
    };

    Ok(ExpandResult {
        has_more: offset.saturating_add(children.len()) < total_children,
        children,
        total_children,
        offset,
    })
}

#[tauri::command]
pub fn get_result_node_value(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let store = state
        .result_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;

    let value = store
        .get_value_at_path(&path)
        .map_err(|error| error.to_string())?;

    let serialized = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;

    if serialized.len() <= MAX_NODE_VALUE_BYTES {
        return Ok(serialized);
    }

    Ok(format!(
        "{}\n... (truncated)",
        truncate_utf8_bytes(&serialized, MAX_NODE_VALUE_BYTES)
    ))
}
