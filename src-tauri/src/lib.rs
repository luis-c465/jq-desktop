mod commands;
mod error;
mod jq_engine;
mod json_store;
mod lsp_client;
mod result_store;
mod state;
mod tree_nav;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::file::load_file,
            commands::file::close_file,
            commands::file::get_file_info,
            commands::file::get_file_size,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
