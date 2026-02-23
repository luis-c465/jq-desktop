use crate::error::AppError;
use crate::tree_nav::{
    get_children_of_value, get_value_at_path, value_to_indexed_node_info, TreeNodeInfo,
};
use serde_json::Value;

#[derive(Debug, Default)]
pub struct ResultStore {
    results: Vec<Value>,
}

impl ResultStore {
    pub fn clear(&mut self) {
        self.results.clear();
    }

    pub fn push(&mut self, value: Value) {
        self.results.push(value);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.results.len()
    }

    pub fn get_result_root_nodes(&self, offset: usize, limit: usize) -> (Vec<TreeNodeInfo>, usize) {
        let total_count = self.results.len();
        let start = offset.min(total_count);
        let nodes = self
            .results
            .iter()
            .enumerate()
            .skip(start)
            .take(limit)
            .map(|(index, value)| value_to_indexed_node_info("$result", index, value))
            .collect();

        (nodes, total_count)
    }

    pub fn get_children(
        &self,
        path: &str,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<TreeNodeInfo>, usize), AppError> {
        let (result_index, sub_path) = parse_result_path(path)?;
        let root = self.get_result_by_index(result_index)?;
        let value = get_value_at_path(root, &sub_path)?;
        get_children_of_value(value, path, offset, limit)
    }

    pub fn get_value_at_path(&self, path: &str) -> Result<&Value, AppError> {
        let (result_index, sub_path) = parse_result_path(path)?;
        let root = self.get_result_by_index(result_index)?;
        get_value_at_path(root, &sub_path)
    }

    fn get_result_by_index(&self, index: usize) -> Result<&Value, AppError> {
        self.results.get(index).ok_or_else(|| {
            AppError::ParseError(format!(
                "Result index {index} is out of range ({} results).",
                self.results.len()
            ))
        })
    }
}

fn parse_result_path(path: &str) -> Result<(usize, String), AppError> {
    const PREFIX: &str = "$result[";

    if !path.starts_with(PREFIX) {
        return Err(AppError::ParseError(format!(
            "Invalid result path '{path}'. Expected prefix '$result[N]'."
        )));
    }

    let rest = &path[PREFIX.len()..];
    let closing_bracket = rest.find(']').ok_or_else(|| {
        AppError::ParseError(format!(
            "Invalid result path '{path}'. Missing closing ']'."
        ))
    })?;

    let index_str = &rest[..closing_bracket];
    if index_str.is_empty() || !index_str.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(AppError::ParseError(format!(
            "Invalid result path '{path}'. Result index must be numeric."
        )));
    }

    let result_index = index_str.parse::<usize>().map_err(|_| {
        AppError::ParseError(format!(
            "Invalid result path '{path}'. Could not parse result index."
        ))
    })?;

    let trailing = &rest[closing_bracket + 1..];
    if trailing.is_empty() {
        return Ok((result_index, "$".to_string()));
    }

    if trailing.starts_with('.') || trailing.starts_with('[') {
        return Ok((result_index, format!("${trailing}")));
    }

    Err(AppError::ParseError(format!(
        "Invalid result path '{path}'. Expected '.' or '[' after '$result[N]'."
    )))
}

#[cfg(test)]
mod tests {
    use super::ResultStore;
    use serde_json::json;

    #[test]
    fn push_and_get_result_root_nodes_returns_expected_metadata() {
        let mut store = ResultStore::default();
        store.push(json!({ "users": [1, 2] }));
        store.push(json!("hello"));

        let (nodes, total) = store.get_result_root_nodes(0, 10);

        assert_eq!(total, 2);
        assert_eq!(nodes.len(), 2);

        assert_eq!(nodes[0].id, "$result[0]");
        assert_eq!(nodes[0].key, "0");
        assert_eq!(nodes[0].value_type, "object");
        assert_eq!(nodes[0].preview, "{1 keys}");
        assert_eq!(nodes[0].child_count, Some(1));
        assert!(nodes[0].has_children);

        assert_eq!(nodes[1].id, "$result[1]");
        assert_eq!(nodes[1].key, "1");
        assert_eq!(nodes[1].value_type, "string");
        assert_eq!(nodes[1].preview, "\"hello\"");
        assert_eq!(nodes[1].child_count, None);
        assert!(!nodes[1].has_children);
    }

    #[test]
    fn get_children_navigates_into_result_object() {
        let mut store = ResultStore::default();
        store.push(json!({
            "users": [
                { "name": "alice" },
                { "name": "bob" }
            ]
        }));

        let (children, total) = store
            .get_children("$result[0].users", 0, 10)
            .expect("children should load");

        assert_eq!(total, 2);
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].id, "$result[0].users[0]");
        assert_eq!(children[1].id, "$result[0].users[1]");
    }

    #[test]
    fn get_value_at_path_resolves_nested_paths() {
        let mut store = ResultStore::default();
        store.push(json!({
            "users": [
                { "name": "alice" },
                { "name": "bob" }
            ]
        }));

        let value = store
            .get_value_at_path("$result[0].users[1].name")
            .expect("path should resolve");

        assert_eq!(value, &json!("bob"));
    }

    #[test]
    fn clear_empties_store() {
        let mut store = ResultStore::default();
        store.push(json!(1));
        store.push(json!(2));

        assert_eq!(store.len(), 2);

        store.clear();

        assert_eq!(store.len(), 0);
        let (nodes, total) = store.get_result_root_nodes(0, 10);
        assert!(nodes.is_empty());
        assert_eq!(total, 0);
    }

    #[test]
    fn out_of_bounds_index_returns_error() {
        let mut store = ResultStore::default();
        store.push(json!({ "a": 1 }));

        let error = store
            .get_children("$result[2]", 0, 10)
            .expect_err("out of bounds should fail");

        assert!(error.to_string().contains("Result index 2 is out of range"));
    }
}
