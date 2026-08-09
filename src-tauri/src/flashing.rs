use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use crate::adb_controller::AdbController;
use crate::commands::emit_log;

#[derive(Debug, Clone, Serialize)]
pub struct FlashResult {
    pub serial: String,
    pub partition: String,
    pub file: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlashProgress {
    pub phase: String,
    pub message: String,
    pub percent: u8,
}

pub fn detect_partition_from_filename(filename: &str) -> Option<String> {
    let name = filename.rsplit(['/', '\\']).next().unwrap_or(filename);
    let lower = name.to_lowercase();
    let known = [
        "boot", "recovery", "vbmeta", "system", "vendor", "dtbo", "modem", "oem", "cache", "super",
    ];
    for part in known {
        if lower == part
            || lower.starts_with(&format!("{part}."))
            || lower.starts_with(&format!("{part}_"))
        {
            return Some(part.to_string());
        }
    }
    None
}

pub fn flash_result(serial: &str, partition: &str, file: &str, success: bool, message: &str) -> FlashResult {
    FlashResult {
        serial: serial.to_string(),
        partition: partition.to_string(),
        file: file.to_string(),
        success,
        message: message.to_string(),
    }
}

fn emit_progress(app: &AppHandle, phase: &str, message: &str, percent: u8) {
    let _ = app.emit(
        "flash-progress",
        FlashProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

pub async fn flash_from_url(
    app: &AppHandle,
    serial: &str,
    url: &str,
    partition: Option<String>,
) -> Result<FlashResult, String> {
    let dir = std::env::temp_dir().join(format!("flash_{serial}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Falha ao criar pasta temporária: {e}"))?;
    let file_name = url.rsplit('/').next().unwrap_or("firmware.bin").to_string();
    let download_path = dir.join(&file_name);
    let is_zip = file_name.to_lowercase().ends_with(".zip");

    emit_progress(app, "baixando", &format!("Baixando {file_name}..."), 5);
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar {url}: {e}"))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {e}"))?;
    std::fs::write(&download_path, &bytes)
        .map_err(|e| format!("Falha ao salvar {file_name}: {e}"))?;

    emit_log(app, "ok", &format!("Download concluído: {file_name} ({} bytes)", bytes.len()));

    let mut parts: Vec<(String, PathBuf)> = Vec::new();
    if is_zip {
        emit_progress(app, "extraindo", "Extraindo ZIP...", 30);
        let extract_dir = dir.join("extracted");
        std::fs::create_dir_all(&extract_dir).map_err(|e| format!("Falha ao criar pasta de extração: {e}"))?;
        let file = std::fs::File::open(&download_path)
            .map_err(|e| format!("Falha ao abrir ZIP: {e}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("ZIP inválido: {e}"))?;
        archive
            .extract(&extract_dir)
            .map_err(|e| format!("Falha ao extrair ZIP: {e}"))?;
        emit_log(app, "ok", "ZIP extraído.");

        let wanted = partition.clone().map(|p| format!("{p}.img"));
        let mut found = Vec::new();
        collect_img_files(&extract_dir, &extract_dir, &mut found);
        for f in found {
            let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
            if let Some(part) = detect_partition_from_filename(&stem) {
                if wanted.is_none() || wanted.as_deref() == Some(&format!("{part}.img")) {
                    parts.push((part, f.clone()));
                }
            }
        }
    } else {
        let part = partition
            .clone()
            .or_else(|| detect_partition_from_filename(&file_name))
            .ok_or_else(|| "Partição não identificada. Informe a partição de destino.".to_string())?;
        parts.push((part, download_path.clone()));
    }

    if parts.is_empty() {
        return Err("Nenhuma partição detectada no arquivo.".to_string());
    }

    emit_log(app, "info", &format!("Partições a flashar: {:?}", parts.iter().map(|p| p.0.clone()).collect::<Vec<_>>()));

    let mut last_partition = String::new();
    for (part, path) in &parts {
        emit_progress(app, "flashando", &format!("Flashando {part}..."), 60);
        emit_log(app, "info", &format!("Flashando partição {part} de {}...", path.display()));
        match AdbController::fastboot_flash(app, serial, part, &path.to_string_lossy()).await {
            Ok(()) => {
                emit_log(app, "ok", &format!("Partição {part} flashada."));
                last_partition = part.clone();
            }
            Err(e) => {
                emit_log(app, "error", &format!("Falha ao flashar {part}: {e}"));
                let _ = std::fs::remove_dir_all(&dir);
                return Ok(flash_result(serial, part, &path.to_string_lossy(), false, &format!("Falha ao flashar {part}: {e}")));
            }
        }
    }

    emit_progress(app, "concluído", "Flash concluído", 100);
    let _ = std::fs::remove_dir_all(&dir);
    Ok(flash_result(serial, &last_partition, &file_name, true, "Flash concluído com sucesso"))
}

fn collect_img_files(base: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_img_files(base, &path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("img") {
                out.push(path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_partitions() {
        assert_eq!(detect_partition_from_filename("boot.img").as_deref(), Some("boot"));
        assert_eq!(detect_partition_from_filename("recovery.img").as_deref(), Some("recovery"));
        assert_eq!(detect_partition_from_filename("vbmeta.img").as_deref(), Some("vbmeta"));
        assert_eq!(detect_partition_from_filename("system.img").as_deref(), Some("system"));
        assert_eq!(detect_partition_from_filename("vendor.img").as_deref(), Some("vendor"));
        assert_eq!(detect_partition_from_filename("dtbo.img").as_deref(), Some("dtbo"));
    }

    #[test]
    fn returns_none_for_unknown() {
        assert_eq!(detect_partition_from_filename("random.txt"), None);
        assert_eq!(detect_partition_from_filename(""), None);
        assert_eq!(detect_partition_from_filename("scatter.txt"), None);
    }

    #[test]
    fn flash_result_assembles_success() {
        let r = flash_result("ROJNKFZ57XJFD6N7", "boot", "boot.img", true, "Flash concluído");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert_eq!(r.partition, "boot");
        assert!(r.success);
    }
}
