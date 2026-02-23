use crate::error::AppError;
use crate::tree_nav::{
    get_children_of_value, get_root_nodes_of_value, get_value_at_path as get_value_at_path_for_root,
};
use serde_json::Value;

pub use crate::tree_nav::TreeNodeInfo;

#[derive(Debug, Default)]
pub struct JsonStore {
    pub data: Option<Value>,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
}

impl JsonStore {
    pub fn get_root_nodes(&self) -> Result<Vec<TreeNodeInfo>, AppError> {
        let root = self.data.as_ref().ok_or(AppError::NoFileLoaded)?;
        Ok(get_root_nodes_of_value(root))
    }

    pub fn get_children(
        &self,
        path: &str,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<TreeNodeInfo>, usize), AppError> {
        let value = self.get_value_at_path(path)?;

        get_children_of_value(value, path, offset, limit)
    }

    pub fn get_value_at_path(&self, path: &str) -> Result<&Value, AppError> {
        let root = self.data.as_ref().ok_or(AppError::NoFileLoaded)?;

        get_value_at_path_for_root(root, path)
    }

    pub fn clear(&mut self) {
        self.data = None;
        self.file_path = None;
        self.file_size = None;
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
