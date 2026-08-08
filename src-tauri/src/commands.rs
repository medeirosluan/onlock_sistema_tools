use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb_simulator::{AdbSimulator, DeviceInfo};

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

#[tauri::command]
pub fn detect_device(
    adb: State<'_, AdbSimulator>,
    app: AppHandle,
    platform: String,
) -> Result<DeviceInfo, String> {
    emit_log(&app, "info", "Conectando ao dispositivo...");
    std::thread::sleep(Duration::from_millis(400));
    emit_log(&app, "info", "Lendo propriedades do dispositivo (getprop)...");
    std::thread::sleep(Duration::from_millis(400));

    let device = adb.detect(&platform);
    let status = AdbStatusPayload {
        connected: device.connected,
        platform: device.platform.clone(),
    };
    let _ = app.emit("adb-status", status);

    if device.connected {
        emit_log(&app, "ok", &format!("Dispositivo identificado: {}", device.model));
        Ok(device)
    } else {
        emit_log(&app, "error", "Nenhum dispositivo encontrado em ADB.");
        Err("Nenhum dispositivo conectado".to_string())
    }
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<(), String> {
    app.emit("logs-cleared", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
