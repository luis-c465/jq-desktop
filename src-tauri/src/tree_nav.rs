use crate::error::AppError;
use serde::Serialize;
use serde_json::Value;

const ROOT_ARRAY_PREVIEW_LIMIT: usize = 1000;
const STRING_PREVIEW_LIMIT: usize = 100;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNodeInfo {
    pub id: String,
    pub key: String,
    pub value_type: String,
    pub preview: String,
    pub child_count: Option<usize>,
    pub has_children: bool,
}

pub fn get_root_nodes_of_value(root: &Value) -> Vec<TreeNodeInfo> {
    match root {
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| value_to_node_info("$", key, value))
            .collect(),
        Value::Array(values) => values
            .iter()
            .enumerate()
            .take(ROOT_ARRAY_PREVIEW_LIMIT)
            .map(|(index, value)| value_to_indexed_node_info("$", index, value))
            .collect(),
        primitive => vec![TreeNodeInfo {
            id: "$".to_string(),
            key: "$".to_string(),
            value_type: value_type_name(primitive).to_string(),
            preview: preview_for_value(primitive),
            child_count: None,
            has_children: false,
        }],
    }
}

pub fn get_children_of_value(
    value: &Value,
    parent_path: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<TreeNodeInfo>, usize), AppError> {
    if limit == 0 {
        return Ok((Vec::new(), child_count_for(value)));
    }

    match value {
        Value::Object(map) => {
            let total_count = map.len();
            let start = offset.min(total_count);
            let children = map
                .iter()
                .skip(start)
                .take(limit)
                .map(|(key, value)| value_to_node_info(parent_path, key, value))
                .collect();
            Ok((children, total_count))
        }
        Value::Array(values) => {
            let total_count = values.len();
            let start = offset.min(total_count);
            let children = values
                .iter()
                .enumerate()
                .skip(start)
                .take(limit)
                .map(|(index, value)| value_to_indexed_node_info(parent_path, index, value))
                .collect();
            Ok((children, total_count))
        }
        _ => Ok((Vec::new(), 0)),
    }
}

pub fn get_value_at_path<'a>(root: &'a Value, path: &str) -> Result<&'a Value, AppError> {
    // Limitation (v1): object keys containing '.' or '['/']' are not escaped in path syntax.
    if path == "$" {
        return Ok(root);
    }

    if !path.starts_with('$') {
        return Err(AppError::ParseError(
            "Invalid path. Path must start with '$'.".to_string(),
        ));
    }

    let chars: Vec<char> = path.chars().collect();
    let mut index = 1;
    let mut current = root;

    while index < chars.len() {
        match chars[index] {
            '.' => {
                index += 1;
                let key_start = index;
                while index < chars.len() && chars[index] != '.' && chars[index] != '[' {
                    index += 1;
                }

                if key_start == index {
                    return Err(AppError::ParseError(format!(
                        "Invalid path segment in '{path}'."
                    )));
                }

                let key: String = chars[key_start..index].iter().collect();
                current = current.get(&key).ok_or_else(|| {
                    AppError::ParseError(format!("Path not found: '{path}' at key '{key}'."))
                })?;
            }
            '[' => {
                index += 1;
                let number_start = index;

                while index < chars.len() && chars[index].is_ascii_digit() {
                    index += 1;
                }

                if number_start == index {
                    return Err(AppError::ParseError(format!(
                        "Invalid array index in path '{path}'."
                    )));
                }

                if index >= chars.len() || chars[index] != ']' {
                    return Err(AppError::ParseError(format!(
                        "Unclosed array index in path '{path}'."
                    )));
                }

                let index_value: usize = chars[number_start..index]
                    .iter()
                    .collect::<String>()
                    .parse()
                    .map_err(|_| {
                        AppError::ParseError(format!("Invalid array index in path '{path}'."))
                    })?;

                index += 1;
                current = current.get(index_value).ok_or_else(|| {
                    AppError::ParseError(format!(
                        "Path not found: '{path}' at index {index_value}."
                    ))
                })?;
            }
            token => {
                return Err(AppError::ParseError(format!(
                    "Unexpected token '{token}' in path '{path}'."
                )));
            }
        }
    }

    Ok(current)
}

fn value_to_node_info(parent_path: &str, key: &str, value: &Value) -> TreeNodeInfo {
    let id = format!("{parent_path}.{key}");
    TreeNodeInfo {
        id,
        key: key.to_string(),
        value_type: value_type_name(value).to_string(),
        preview: preview_for_value(value),
        child_count: child_count(value),
        has_children: has_children(value),
    }
}

fn value_to_indexed_node_info(parent_path: &str, index: usize, value: &Value) -> TreeNodeInfo {
    TreeNodeInfo {
        id: format!("{parent_path}[{index}]"),
        key: index.to_string(),
        value_type: value_type_name(value).to_string(),
        preview: preview_for_value(value),
        child_count: child_count(value),
        has_children: has_children(value),
    }
}

fn value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Object(_) => "object",
        Value::Array(_) => "array",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
    }
}

fn preview_for_value(value: &Value) -> String {
    match value {
        Value::Object(map) => format!("{{{} keys}}", map.len()),
        Value::Array(values) => format!("[{} items]", values.len()),
        Value::String(text) => {
            let escaped: String = text.chars().flat_map(char::escape_default).collect();
            let truncated = truncate_chars(&escaped, STRING_PREVIEW_LIMIT);
            format!("\"{truncated}\"")
        }
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => "null".to_string(),
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn child_count(value: &Value) -> Option<usize> {
    match value {
        Value::Object(map) => Some(map.len()),
        Value::Array(values) => Some(values.len()),
        _ => None,
    }
}

fn child_count_for(value: &Value) -> usize {
    child_count(value).unwrap_or(0)
}

fn has_children(value: &Value) -> bool {
    match value {
        Value::Object(map) => !map.is_empty(),
        Value::Array(values) => !values.is_empty(),
        _ => false,
    }
}
