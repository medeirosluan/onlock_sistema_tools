mod adb_simulator;
mod commands;

use adb_simulator::AdbSimulator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AdbSimulator)
        .invoke_handler(tauri::generate_handler![
            commands::detect_device,
            commands::clear_logs,
            commands::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
