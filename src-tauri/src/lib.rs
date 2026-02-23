mod commands;
mod error;
mod jq_engine;
mod json_store;
mod lsp_client;
mod result_store;
mod state;
mod tree_nav;

use crate::state::AppState;
use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::Manager;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::RunEvent;

fn initial_file_from_args() -> Option<String> {
    std::env::args_os().skip(1).find_map(|arg| {
        if arg.to_string_lossy().starts_with('-') {
            return None;
        }

        let path = PathBuf::from(arg);
        if path.is_file() {
            return path.to_str().map(ToOwned::to_owned);
        }

        None
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|app| {
            if let Some(path) = initial_file_from_args() {
                if let Ok(mut pending) = app.state::<AppState>().pending_open_file.lock() {
                    *pending = Some(path);
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::file::load_file,
            commands::file::close_file,
            commands::file::get_file_info,
            commands::file::get_file_size,
            commands::file::get_initial_file,
            commands::tree::expand_node,
            commands::tree::get_node_value,
            commands::result_tree::expand_result_node,
            commands::result_tree::get_result_node_value,
            commands::query::run_jq_query,
            commands::query::validate_jq_query,
            commands::query::cancel_query,
            commands::lsp::lsp_initialize,
            commands::lsp::lsp_did_change,
            commands::lsp::lsp_hover,
            commands::lsp::lsp_complete,
            commands::lsp::lsp_shutdown
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let RunEvent::Opened { urls } = _event {
                let Some(path) = urls.first().and_then(|url| {
                    url.to_file_path()
                        .ok()
                        .and_then(|path| path.to_str().map(ToOwned::to_owned))
                }) else {
                    return;
                };

                if let Ok(mut pending) = _app.state::<AppState>().pending_open_file.lock() {
                    *pending = Some(path.clone());
                }

                let _ = _app.emit("open-file", path);

                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
