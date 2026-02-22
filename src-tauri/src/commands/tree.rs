use crate::json_store::TreeNodeInfo;
use crate::state::AppState;
use serde::Serialize;

const DEFAULT_EXPAND_OFFSET: usize = 0;
const DEFAULT_EXPAND_LIMIT: usize = 500;
const MAX_NODE_VALUE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandResult {
    pub children: Vec<TreeNodeInfo>,
    pub total_children: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[tauri::command]
pub fn expand_node(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<ExpandResult, String> {
    let offset = offset.unwrap_or(DEFAULT_EXPAND_OFFSET);
    let limit = limit.unwrap_or(DEFAULT_EXPAND_LIMIT);

    let store = state
        .json_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;

    let (children, total_children) = if path == "$" {
        let value = store
            .get_value_at_path(&path)
            .map_err(|error| error.to_string())?;

        if value.is_object() || value.is_array() {
            store
                .get_children(&path, offset, limit)
                .map_err(|error| error.to_string())?
        } else {
            let root_nodes = store.get_root_nodes().map_err(|error| error.to_string())?;
            let total = root_nodes.len();
            let start = offset.min(total);
            let children = root_nodes.into_iter().skip(start).take(limit).collect();
            (children, total)
        }
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
pub fn get_node_value(path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let store = state
        .json_store
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

fn truncate_utf8_bytes(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }

    let mut end = 0;
    for (idx, ch) in input.char_indices() {
        let ch_end = idx + ch.len_utf8();
        if ch_end > max_bytes {
            break;
        }
        end = ch_end;
    }

    input[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::truncate_utf8_bytes;

    #[test]
    fn truncate_utf8_bytes_keeps_valid_utf8_boundaries() {
        let input = "a😀b";
        let out = truncate_utf8_bytes(input, 2);
        assert_eq!(out, "a");

        let out = truncate_utf8_bytes(input, 5);
        assert_eq!(out, "a😀");
    }
}
