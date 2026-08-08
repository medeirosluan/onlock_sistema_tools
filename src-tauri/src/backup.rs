use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::adb_controller::AdbController;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupCategory {
    Photos,
    Videos,
    Music,
    Downloads,
    Documents,
    Contacts,
    Sms,
}

impl BackupCategory {
    pub fn id(&self) -> &'static str {
        match self {
            BackupCategory::Photos => "photos",
            BackupCategory::Videos => "videos",
            BackupCategory::Music => "music",
            BackupCategory::Downloads => "downloads",
            BackupCategory::Documents => "documents",
            BackupCategory::Contacts => "contacts",
            BackupCategory::Sms => "sms",
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            BackupCategory::Photos => "Fotos",
            BackupCategory::Videos => "Vídeos",
            BackupCategory::Music => "Música",
            BackupCategory::Downloads => "Downloads",
            BackupCategory::Documents => "Documentos",
            BackupCategory::Contacts => "Contatos",
            BackupCategory::Sms => "SMS",
        }
    }
    pub fn all() -> Vec<BackupCategory> {
        vec![
            BackupCategory::Photos,
            BackupCategory::Videos,
            BackupCategory::Music,
            BackupCategory::Downloads,
            BackupCategory::Documents,
            BackupCategory::Contacts,
            BackupCategory::Sms,
        ]
    }
}

pub fn category_to_device_paths(cat: &BackupCategory) -> Vec<String> {
    match cat {
        BackupCategory::Photos => vec!["/sdcard/DCIM".to_string(), "/sdcard/Pictures".to_string()],
        BackupCategory::Videos => vec![
            "/sdcard/DCIM/Camera".to_string(),
            "/sdcard/Movies".to_string(),
        ],
        BackupCategory::Music => vec![
            "/sdcard/Music".to_string(),
            "/sdcard/Notifications".to_string(),
            "/sdcard/Ringtones".to_string(),
        ],
        BackupCategory::Downloads => vec!["/sdcard/Download".to_string()],
        BackupCategory::Documents => vec!["/sdcard/Documents".to_string()],
        BackupCategory::Contacts => vec!["content://contacts/contacts/export".to_string()],
        BackupCategory::Sms => vec!["content://sms".to_string()],
    }
}

pub fn compute_percent(files_done: usize, total: usize) -> u8 {
    if total == 0 {
        return 0;
    }
    ((files_done as f64 / total as f64) * 100.0).round() as u8
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupProgress {
    pub category: String,
    pub file: String,
    pub files_done: usize,
    pub total_files: usize,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub serial: String,
    pub destination: String,
    pub categories_done: Vec<String>,
    pub files_copied: usize,
    pub message: String,
}

pub struct BackupManager;

impl BackupManager {
    pub async fn run_backup(
        _app: &AppHandle,
        serial: &str,
        _categories: Vec<String>,
        destination: &str,
    ) -> Result<BackupResult, String> {
        Ok(BackupResult {
            serial: serial.to_string(),
            destination: destination.to_string(),
            categories_done: Vec::new(),
            files_copied: 0,
            message: "não implementado".to_string(),
        })
    }

    pub async fn restore(
        _app: &AppHandle,
        serial: &str,
        destination: &str,
        _categories: Vec<String>,
    ) -> Result<BackupResult, String> {
        Ok(BackupResult {
            serial: serial.to_string(),
            destination: destination.to_string(),
            categories_done: Vec::new(),
            files_copied: 0,
            message: "não implementado".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_have_ids_and_labels() {
        let categories = BackupCategory::all();
        assert_eq!(categories.len(), 7);
        for cat in &categories {
            assert!(!cat.id().is_empty());
            assert!(!cat.label().is_empty());
        }
        assert_eq!(BackupCategory::Photos.id(), "photos");
        assert_eq!(BackupCategory::Sms.id(), "sms");
    }

    #[test]
    fn category_paths_map_correctly() {
        let photos = category_to_device_paths(&BackupCategory::Photos);
        assert!(photos.contains(&"/sdcard/DCIM".to_string()));
        assert!(photos.contains(&"/sdcard/Pictures".to_string()));

        let downloads = category_to_device_paths(&BackupCategory::Downloads);
        assert!(downloads.contains(&"/sdcard/Download".to_string()));

        let contacts = category_to_device_paths(&BackupCategory::Contacts);
        assert_eq!(contacts.len(), 1);
        assert!(contacts[0].starts_with("content://"));

        let sms = category_to_device_paths(&BackupCategory::Sms);
        assert!(sms[0].starts_with("content://"));
    }

    #[test]
    fn compute_percent_is_correct() {
        assert_eq!(compute_percent(0, 10), 0);
        assert_eq!(compute_percent(10, 10), 100);
        assert_eq!(compute_percent(5, 10), 50);
        assert_eq!(compute_percent(0, 0), 0);
    }
}
