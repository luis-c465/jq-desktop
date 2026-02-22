mod commands;
mod error;
mod jq_engine;
mod json_store;
mod state;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::file::load_file,
            commands::file::close_file,
            commands::file::get_file_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
