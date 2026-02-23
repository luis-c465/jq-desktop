use crate::json_store::JsonStore;
use crate::lsp_client::LspClient;
use crate::result_store::ResultStore;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;

pub struct AppState {
    pub json_store: Mutex<JsonStore>,
    pub result_store: Mutex<ResultStore>,
    pub pending_open_file: Mutex<Option<String>>,
    pub query_cancelled: Arc<AtomicBool>,
    pub lsp_client: TokioMutex<Option<LspClient>>,
}

impl AppState {
    pub fn cancel_query(&self) {
        self.query_cancelled.store(true, Ordering::Relaxed);
    }

    pub fn reset_cancellation(&self) {
        self.query_cancelled.store(false, Ordering::Relaxed);
    }

    pub fn is_query_cancelled(&self) -> bool {
        self.query_cancelled.load(Ordering::Relaxed)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            json_store: Mutex::new(JsonStore::default()),
            result_store: Mutex::new(ResultStore::default()),
            pending_open_file: Mutex::new(None),
            query_cancelled: Arc::new(AtomicBool::new(false)),
            lsp_client: TokioMutex::new(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;

    #[test]
    fn query_cancellation_flag_round_trip() {
        let state = AppState::default();
        assert!(!state.is_query_cancelled());

        state.cancel_query();
        assert!(state.is_query_cancelled());

        state.reset_cancellation();
        assert!(!state.is_query_cancelled());
    }
}
