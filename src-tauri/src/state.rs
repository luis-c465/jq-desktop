use crate::json_store::JsonStore;
use std::sync::Mutex;

pub struct AppState {
    pub json_store: Mutex<JsonStore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            json_store: Mutex::new(JsonStore::default()),
        }
    }
}
