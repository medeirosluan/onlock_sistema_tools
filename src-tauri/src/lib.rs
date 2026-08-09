mod adb_controller;
mod adb_simulator;
mod backup;
mod commands;
mod operations;

use adb_controller::CancelFlag;
use adb_simulator::AdbSimulator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AdbSimulator)
        .manage(CancelFlag::default())
        .invoke_handler(tauri::generate_handler![
            commands::detect_device,
            commands::list_devices,
            commands::start_adb_server,
            commands::run_frp_removal,
            commands::reboot_device,
            commands::unlock_bootloader,
            commands::fastboot_reboot,
            commands::fastboot_getvar,
            commands::run_backup,
            commands::restore_backup,
            commands::cancel_backup,
            commands::clear_logs,
            commands::get_app_version,
            commands::format_userdata,
            commands::reboot_bootloader_cmd,
            commands::check_frp_status,
            commands::list_apps,
            commands::manage_apps,
            commands::detect_connection_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
