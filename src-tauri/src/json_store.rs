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

#[derive(Debug, Default)]
pub struct JsonStore {
    pub data: Option<Value>,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
}

impl JsonStore {
    pub fn get_root_nodes(&self) -> Result<Vec<TreeNodeInfo>, AppError> {
        let root = self.data.as_ref().ok_or(AppError::NoFileLoaded)?;

        let nodes = match root {
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
        };

        Ok(nodes)
    }

    pub fn get_children(
        &self,
        path: &str,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<TreeNodeInfo>, usize), AppError> {
        let value = self.get_value_at_path(path)?;

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
                    .map(|(key, value)| value_to_node_info(path, key, value))
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
                    .map(|(index, value)| value_to_indexed_node_info(path, index, value))
                    .collect();
                Ok((children, total_count))
            }
            _ => Ok((Vec::new(), 0)),
        }
    }

    pub fn get_value_at_path(&self, path: &str) -> Result<&Value, AppError> {
        // Limitation (v1): object keys containing '.' or '['/']' are not escaped in path syntax.
        let root = self.data.as_ref().ok_or(AppError::NoFileLoaded)?;

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

    pub fn clear(&mut self) {
        self.data = None;
        self.file_path = None;
        self.file_size = None;
    }
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

#[cfg(test)]
mod tests {
    use super::JsonStore;
    use serde_json::json;

    fn build_store(value: serde_json::Value) -> JsonStore {
        JsonStore {
            data: Some(value),
            file_path: Some("/tmp/test.json".to_string()),
            file_size: Some(12),
        }
    }

    #[test]
    fn get_root_nodes_returns_expected_metadata() {
        let store = build_store(json!({
            "name": "alice",
            "age": 30,
            "nested": { "ok": true }
        }));

        let nodes = store.get_root_nodes().expect("root nodes should load");
        assert_eq!(nodes.len(), 3);

        let name_node = nodes.iter().find(|node| node.key == "name").unwrap();
        assert_eq!(name_node.id, "$.name");
        assert_eq!(name_node.value_type, "string");
        assert_eq!(name_node.preview, "\"alice\"");
        assert_eq!(name_node.child_count, None);
        assert!(!name_node.has_children);

        let age_node = nodes.iter().find(|node| node.key == "age").unwrap();
        assert_eq!(age_node.id, "$.age");
        assert_eq!(age_node.value_type, "number");
        assert_eq!(age_node.preview, "30");
        assert_eq!(age_node.child_count, None);
        assert!(!age_node.has_children);

        let nested_node = nodes.iter().find(|node| node.key == "nested").unwrap();
        assert_eq!(nested_node.id, "$.nested");
        assert_eq!(nested_node.value_type, "object");
        assert_eq!(nested_node.preview, "{1 keys}");
        assert_eq!(nested_node.child_count, Some(1));
        assert!(nested_node.has_children);
    }

    #[test]
    fn get_children_returns_nested_items() {
        let store = build_store(json!({
            "users": [
                { "name": "a" },
                { "name": "b" }
            ]
        }));

        let (children, total) = store
            .get_children("$.users", 0, 10)
            .expect("children should load");

        assert_eq!(total, 2);
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].id, "$.users[0]");
        assert_eq!(children[0].key, "0");
        assert_eq!(children[0].value_type, "object");
        assert_eq!(children[1].id, "$.users[1]");
    }

    #[test]
    fn get_value_at_path_handles_arrays_and_objects() {
        let store = build_store(json!({
            "users": [
                { "name": "alice", "age": 30 },
                { "name": "bob", "age": 28 }
            ]
        }));

        let value = store
            .get_value_at_path("$.users[1].name")
            .expect("path should resolve");

        assert_eq!(value, &json!("bob"));
    }
}
