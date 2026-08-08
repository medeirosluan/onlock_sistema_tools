use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb_controller::{AdbController, AdbDevice, CancelFlag};
use crate::adb_simulator::{AdbSimulator, DeviceInfo};
use crate::backup::{BackupManager, BackupResult};
use crate::operations::{BootloaderResult, BootloaderUnlocker, FrpRemover, FrpResult};

#[derive(Debug, Clone, Serialize)]
pub struct LogPayload {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdbStatusPayload {
    pub connected: bool,
    pub platform: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormatResult {
    pub serial: String,
    pub success: bool,
    pub message: String,
}

fn format_result(serial: &str, success: bool, message: &str) -> FormatResult {
    FormatResult {
        serial: serial.to_string(),
        success,
        message: message.to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FrpStatus {
    pub frp_blocked: bool,
    pub oem_unlock_allowed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppInfo {
    pub package: String,
    pub system: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManageAppsResult {
    pub processed: usize,
    pub failed: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceHealth {
    pub model: String,
    pub imei: String,
    pub android_version: String,
    pub build: String,
    pub total_storage: String,
    pub free_storage: String,
    pub battery: u8,
    pub frp_blocked: bool,
}

fn parse_apps(output: &str) -> Vec<AppInfo> {
    let mut apps = Vec::new();
    let mut system = false;
    let mut enabled = true;
    for line in output.lines() {
        let line = line.trim();
        if line.contains("SYSTEM_APPS") {
            system = true;
            continue;
        }
        if line.contains("USER_APPS") {
            system = false;
            continue;
        }
        if line.contains("DISABLED_APPS") {
            system = false;
            enabled = false;
            continue;
        }
        if let Some(pkg) = line.strip_prefix("package:") {
            apps.push(AppInfo {
                package: pkg.to_string(),
                system,
                enabled,
            });
        }
    }
    apps
}

fn parse_frp_pst(value: &str) -> bool {
    !value.trim().is_empty()
}

fn parse_boolean(value: &str) -> bool {
    matches!(value.trim().to_lowercase().as_str(), "true" | "1")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn emit_log(app: &AppHandle, level: &str, message: &str) {
    let payload = LogPayload {
        timestamp: now_ms(),
        level: level.to_string(),
        message: message.to_string(),
    };
    let _ = app.emit("log-event", payload);
}

fn emit_status(app: &AppHandle, connected: bool, platform: String, mode: String) {
    let payload = AdbStatusPayload {
        connected,
        platform,
        mode,
    };
    let _ = app.emit("adb-status", payload);
}

#[tauri::command]
pub async fn start_adb_server(app: AppHandle) -> Result<(), String> {
    emit_log(&app, "info", "Iniciando adb server...");
    match AdbController::start_server(&app).await {
        Ok(()) => {
            emit_status(&app, true, String::new(), "real".to_string());
            emit_log(&app, "ok", "ADB server iniciado.");
            Ok(())
        }
        Err(e) => {
            emit_log(&app, "warn", &format!("ADB indisponível — modo simulação será usado: {e}"));
            emit_status(&app, false, String::new(), "sim".to_string());
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Result<Vec<AdbDevice>, String> {
    AdbController::list_devices(&app).await
}

#[tauri::command]
pub async fn detect_device(
    adb: State<'_, AdbSimulator>,
    app: AppHandle,
    serial: String,
    platform: String,
) -> Result<DeviceInfo, String> {
    emit_log(&app, "info", &format!("Detectando dispositivo {serial}..."));

    let model = AdbController::getprop(&app, &serial, "ro.product.model").await;
    if model.is_err() {
        emit_log(&app, "warn", "Falha ao ler propriedades via ADB — usando modo simulação.");
        let device = adb.detect(&platform);
        emit_status(&app, device.connected, device.platform.clone(), "sim".to_string());
        emit_log(&app, "ok", &format!("Dispositivo (simulação) identificado: {}", device.model));
        return Ok(device);
    }

    let model = model.unwrap();
    emit_log(&app, "info", &format!("Modelo: {model}"));

    let brand = AdbController::getprop(&app, &serial, "ro.product.brand")
        .await
        .unwrap_or_default();
    let android_version = AdbController::getprop(&app, &serial, "ro.build.version.release")
        .await
        .unwrap_or_default();
    let board = AdbController::getprop(&app, &serial, "ro.board.platform")
        .await
        .unwrap_or_default();
    let battery = AdbController::battery_level(&app, &serial)
        .await
        .unwrap_or(None);
    let imei = AdbController::imei(&app, &serial).await.unwrap_or(None);

    let platform_mapped = crate::adb_controller::map_platform(&brand, &board);
    let device = DeviceInfo {
        model: model.clone(),
        brand,
        serial: serial.clone(),
        android_version,
        platform: platform_mapped,
        connected: true,
        battery: battery.unwrap_or(0),
        imei: imei.unwrap_or_default(),
    };

    emit_status(&app, true, device.platform.clone(), "real".to_string());
    emit_log(&app, "ok", &format!("Dispositivo identificado: {}", device.model));
    Ok(device)
}

#[tauri::command]
pub async fn run_frp_removal(app: AppHandle, serial: String) -> Result<FrpResult, String> {
    emit_log(&app, "info", &format!("Iniciando remoção de FRP no dispositivo {serial}..."));
    FrpRemover::run(&app, &serial).await
}

#[tauri::command]
pub async fn reboot_device(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando dispositivo {serial}..."));
    AdbController::reboot(&app, &serial).await?;
    emit_log(&app, "ok", &format!("Reinício iniciado em {serial}."));
    Ok(())
}

#[tauri::command]
pub async fn unlock_bootloader(app: AppHandle, serial: String) -> Result<BootloaderResult, String> {
    emit_log(&app, "info", &format!("Iniciando desbloqueio do bootloader no dispositivo {serial}..."));
    BootloaderUnlocker::run(&app, &serial).await
}

#[tauri::command]
pub async fn fastboot_reboot(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando dispositivo {serial} (fastboot)..."));
    AdbController::fastboot_reboot(&app, &serial).await?;
    emit_log(&app, "ok", &format!("Reinício iniciado em {serial}."));
    Ok(())
}

#[tauri::command]
pub async fn run_backup(
    app: AppHandle,
    flag: State<'_, CancelFlag>,
    serial: String,
    categories: Vec<String>,
    destination: String,
) -> Result<BackupResult, String> {
    emit_log(&app, "info", &format!("Iniciando backup do dispositivo {serial}..."));
    BackupManager::run_backup(&app, &serial, categories, &destination, &flag).await
}

#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    flag: State<'_, CancelFlag>,
    serial: String,
    destination: String,
    categories: Vec<String>,
) -> Result<BackupResult, String> {
    emit_log(&app, "info", &format!("Iniciando restauração do dispositivo {serial}..."));
    BackupManager::restore(&app, &serial, &destination, categories, &flag).await
}

#[tauri::command]
pub async fn cancel_backup(flag: State<'_, CancelFlag>) -> Result<(), String> {
    flag.0.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn reboot_bootloader_cmd(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando {serial} em modo fastboot..."));
    AdbController::reboot_bootloader(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao reiniciar em fastboot: {e}"));
        format!("Falha ao reiniciar {serial} em fastboot: {e}")
    })?;
    emit_log(&app, "ok", &format!("{serial} reiniciado em fastboot."));
    Ok(())
}

#[tauri::command]
pub async fn format_userdata(app: AppHandle, serial: String) -> Result<FormatResult, String> {
    emit_log(&app, "info", &format!("Iniciando formatação do userdata em {serial}..."));

    AdbController::reboot_bootloader(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao reiniciar em fastboot: {e}"));
        format!("Falha ao reiniciar {serial} em fastboot: {e}")
    })?;
    emit_log(&app, "ok", "Aparelho reiniciado em modo fastboot.");

    AdbController::wait_for_fastboot_device(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("{e}"));
        e
    })?;
    emit_log(&app, "ok", "Aparelho detectado em modo fastboot.");

    AdbController::fastboot_long(&app, &serial, &["erase", "userdata"]).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao apagar userdata: {e}"));
        format!("Falha ao apagar userdata em {serial}: {e}")
    })?;
    emit_log(&app, "ok", "Partição userdata apagada.");

    AdbController::fastboot_reboot(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao reiniciar: {e}"));
        format!("Falha ao reiniciar {serial}: {e}")
    })?;
    emit_log(&app, "ok", &format!("{serial} reiniciado após formatação."));

    Ok(format_result(&serial, true, "Userdata formatado com sucesso"))
}

#[tauri::command]
pub async fn check_frp_status(app: AppHandle, serial: String) -> Result<FrpStatus, String> {
    let frp_value = AdbController::getprop(&app, &serial, "ro.frp.pst")
        .await
        .unwrap_or_default();
    let oem_value = AdbController::getprop(&app, &serial, "sys.oem_unlock_allowed")
        .await
        .unwrap_or_default();
    let frp_blocked = parse_frp_pst(&frp_value);
    let oem_unlock_allowed = parse_boolean(&oem_value);

    if frp_blocked {
        emit_log(&app, "warn", &format!("FRP presente no dispositivo {serial}."));
        Ok(FrpStatus {
            frp_blocked,
            oem_unlock_allowed,
            message: "FRP presente — aparelho não está limpo para revenda".to_string(),
        })
    } else {
        emit_log(&app, "ok", &format!("FRP limpo no dispositivo {serial}."));
        Ok(FrpStatus {
            frp_blocked,
            oem_unlock_allowed,
            message: "FRP limpo — aparelho pronto para revenda".to_string(),
        })
    }
}

#[tauri::command]
pub async fn list_apps(app: AppHandle, serial: String) -> Result<Vec<AppInfo>, String> {
    let user = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-3"])
        .await
        .unwrap_or_default();
    let system = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-s"])
        .await
        .unwrap_or_default();
    let disabled = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-d"])
        .await
        .unwrap_or_default();

    let mut combined = String::new();
    combined.push_str("SYSTEM_APPS\n");
    combined.push_str(&system);
    combined.push_str("USER_APPS\n");
    combined.push_str(&user);
    combined.push_str("DISABLED_APPS\n");
    combined.push_str(&disabled);

    let apps = parse_apps(&combined);
    Ok(apps)
}

#[tauri::command]
pub async fn manage_apps(
    app: AppHandle,
    serial: String,
    packages: Vec<String>,
    action: String,
) -> Result<ManageAppsResult, String> {
    let mut processed = 0usize;
    let mut failed = Vec::new();

    for pkg in &packages {
        let args: &[&str] = match action.as_str() {
            "disable" => &["pm", "disable-user", "--user", "0", pkg],
            "uninstall" => &["pm", "uninstall", "--user", "0", pkg],
            _ => return Err(format!("Ação inválida: {action}. Use 'disable' ou 'uninstall'.")),
        };
        match AdbController::run_shell(&app, &serial, args).await {
            Ok(_) => {
                processed += 1;
                emit_log(&app, "ok", &format!("{action}: {pkg}"));
            }
            Err(e) => {
                failed.push(pkg.clone());
                emit_log(&app, "warn", &format!("{action} falhou em {pkg}: {e}"));
            }
        }
    }

    let failed_count = failed.len();
    Ok(ManageAppsResult {
        processed,
        failed,
        message: format!("{action}: {processed} processados, {failed_count} falhas"),
    })
}

#[tauri::command]
pub async fn device_health(app: AppHandle, serial: String) -> Result<DeviceHealth, String> {
    let model = AdbController::getprop(&app, &serial, "ro.product.model")
        .await
        .unwrap_or_default();
    let android_version = AdbController::getprop(&app, &serial, "ro.build.version.release")
        .await
        .unwrap_or_default();
    let build = AdbController::getprop(&app, &serial, "ro.build.display.id")
        .await
        .unwrap_or_default();
    let imei = AdbController::imei(&app, &serial)
        .await
        .unwrap_or(None)
        .unwrap_or_default();
    let battery = AdbController::battery_level(&app, &serial)
        .await
        .unwrap_or(None)
        .unwrap_or(0);
    let frp_value = AdbController::getprop(&app, &serial, "ro.frp.pst")
        .await
        .unwrap_or_default();
    let df = AdbController::run_shell(&app, &serial, &["df", "-h", "/data"])
        .await
        .unwrap_or_default();

    let (total_storage, free_storage) = parse_df(&df);

    Ok(DeviceHealth {
        model,
        imei,
        android_version,
        build,
        total_storage,
        free_storage,
        battery,
        frp_blocked: parse_frp_pst(&frp_value),
    })
}

fn parse_df(output: &str) -> (String, String) {
    for line in output.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 4 {
            return (fields[1].to_string(), fields[3].to_string());
        }
    }
    (String::new(), String::new())
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<(), String> {
    app.emit("logs-cleared", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_result_assembles_success() {
        let r = format_result("ROJNKFZ57XJFD6N7", true, "Userdata formatado com sucesso");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.message, "Userdata formatado com sucesso");
    }

    #[test]
    fn format_result_assembles_failure() {
        let r = format_result("ROJNKFZ57XJFD6N7", false, "Falha ao apagar userdata");
        assert!(!r.success);
        assert_eq!(r.message, "Falha ao apagar userdata");
    }

    #[test]
    fn parse_apps_combines_user_system_and_disabled() {
        let output = "USER_APPS\npackage:com.example.app\npackage:com.android.chrome\npackage:com.google.android.gms\n";
        let apps = parse_apps(output);
        assert_eq!(apps.len(), 3);
        assert_eq!(apps[0].package, "com.example.app");
        assert!(!apps[0].system);
    }

    #[test]
    fn parse_apps_marks_system_and_disabled() {
        let output = "SYSTEM_APPS\npackage:com.android.settings\nUSER_APPS\npackage:com.example.app\n";
        let apps = parse_apps(output);
        let settings = apps.iter().find(|a| a.package == "com.android.settings").unwrap();
        assert!(settings.system);
        let app = apps.iter().find(|a| a.package == "com.example.app").unwrap();
        assert!(!app.system);
        assert!(app.enabled);
    }

    #[test]
    fn parse_apps_marks_disabled_section() {
        let output = "USER_APPS\npackage:com.example.app\nDISABLED_APPS\npackage:com.disabled.app\n";
        let apps = parse_apps(output);
        let app = apps.iter().find(|a| a.package == "com.example.app").unwrap();
        assert!(app.enabled);
        let disabled = apps.iter().find(|a| a.package == "com.disabled.app").unwrap();
        assert!(!disabled.enabled);
    }

    #[test]
    fn parse_frp_pst_detects_block() {
        assert!(parse_frp_pst("1"));
        assert!(parse_frp_pst("FRP"));
        assert!(!parse_frp_pst(""));
    }

    #[test]
    fn parse_boolean_handles_common_values() {
        assert!(parse_boolean("true"));
        assert!(parse_boolean("1"));
        assert!(!parse_boolean("false"));
        assert!(!parse_boolean("0"));
        assert!(!parse_boolean(""));
    }
}
