use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb_controller::{AdbController, AdbDevice};
use crate::adb_simulator::{AdbSimulator, DeviceInfo};
use crate::operations::{FrpRemover, FrpResult};

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
pub fn clear_logs(app: AppHandle) -> Result<(), String> {
    app.emit("logs-cleared", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
