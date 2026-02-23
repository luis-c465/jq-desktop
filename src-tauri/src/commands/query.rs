use crate::error::AppError;
use crate::jq_engine::JqEngine;
use crate::state::AppState;
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

const MAX_QUERY_RESULTS: usize = 10_000;
const MAX_QUERY_RESULT_CHARS: usize = 1_000_000;
const QUERY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum QueryResult {
    Compiling,
    Running,
    Result {
        index: usize,
        value: String,
        value_type: String,
    },
    Complete {
        total_results: usize,
        elapsed_ms: u64,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn run_jq_query(
    query: String,
    on_result: Channel<QueryResult>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.reset_cancellation();
    clear_result_store(&state)?;
    let _ = on_result.send(QueryResult::Compiling);

    let input = {
        let store = state
            .json_store
            .lock()
            .map_err(|_| "Failed to acquire application state lock".to_string())?;
        match store.data.clone() {
            Some(data) => data,
            None => {
                let message = "No file loaded".to_string();
                let _ = on_result.send(QueryResult::Error {
                    message: message.clone(),
                });
                return Err(message);
            }
        }
    };

    let _ = on_result.send(QueryResult::Running);

    let started = Instant::now();
    let outputs = match JqEngine::execute(&query, &input) {
        Ok(values) => values,
        Err(error) => {
            clear_result_store(&state)?;
            let message = error.to_string();
            let _ = on_result.send(QueryResult::Error {
                message: message.clone(),
            });
            return Err(message);
        }
    };

    let mut emitted = 0_usize;
    for output in outputs.into_iter().take(MAX_QUERY_RESULTS) {
        if state.is_query_cancelled() {
            clear_result_store(&state)?;
            let message = AppError::Cancelled.to_string();
            let _ = on_result.send(QueryResult::Error {
                message: message.clone(),
            });
            return Err(message);
        }

        if started.elapsed() > QUERY_TIMEOUT {
            clear_result_store(&state)?;
            let message = format!("Query timed out after {} seconds", QUERY_TIMEOUT.as_secs());
            let _ = on_result.send(QueryResult::Error {
                message: message.clone(),
            });
            return Err(message);
        }

        let _ = push_parsed_result(&state, &output.value);

        let value = truncate_chars(&output.value, MAX_QUERY_RESULT_CHARS);
        let _ = on_result.send(QueryResult::Result {
            index: emitted,
            value,
            value_type: output.value_type,
        });

        emitted += 1;
    }

    let _ = on_result.send(QueryResult::Complete {
        total_results: emitted,
        elapsed_ms: started.elapsed().as_millis() as u64,
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_query(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.cancel_query();
    clear_result_store(&state)?;
    Ok(())
}

#[tauri::command]
pub fn validate_jq_query(query: String) -> Result<bool, String> {
    JqEngine::validate(&query)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}... (truncated)")
    } else {
        truncated
    }
}

fn clear_result_store(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    let mut result_store = state
        .result_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;
    result_store.clear();
    Ok(())
}

fn push_parsed_result(state: &tauri::State<'_, AppState>, value: &str) -> Result<(), String> {
    let parsed = match serde_json::from_str::<serde_json::Value>(value) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(()),
    };

    let mut result_store = state
        .result_store
        .lock()
        .map_err(|_| "Failed to acquire application state lock".to_string())?;
    result_store.push(parsed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_jq_query;

    #[test]
    fn validates_valid_query() {
        let is_valid = validate_jq_query(".name".to_string()).expect("query should validate");
        assert!(is_valid);
    }

    #[test]
    fn rejects_invalid_query() {
        let error = validate_jq_query(".[[[".to_string()).expect_err("query should fail");
        assert!(error.contains("jq"));
    }
}
