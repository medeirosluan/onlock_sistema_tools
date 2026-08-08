mod adb_controller;
mod adb_simulator;
mod commands;
mod operations;

use adb_simulator::AdbSimulator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AdbSimulator)
        .invoke_handler(tauri::generate_handler![
            commands::detect_device,
            commands::list_devices,
            commands::start_adb_server,
            commands::clear_logs,
            commands::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
