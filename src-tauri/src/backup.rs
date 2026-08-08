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
        app: &AppHandle,
        serial: &str,
        categories: Vec<String>,
        destination: &str,
    ) -> Result<BackupResult, String> {
        use tauri::Emitter;

        let mut categories_done = Vec::new();
        let mut files_copied = 0usize;
        let base = std::path::Path::new(destination).join(serial);

        for id in &categories {
            let Some(cat) = BackupCategory::all().into_iter().find(|c| c.id() == id) else {
                continue;
            };
            let paths = category_to_device_paths(&cat);
            let cat_dir = base.join(cat.id());
            std::fs::create_dir_all(&cat_dir).map_err(|e| format!("Falha ao criar pasta de backup: {e}"))?;

            let mut cat_files = 0usize;
            let mut done = 0usize;
            for remote in &paths {
                if remote.starts_with("content://") {
                    let out = AdbController::run_shell(app, serial, &["content", "query", "--uri", remote]).await;
                    let file_name = format!("{}.txt", cat.id());
                    let local = cat_dir.join(&file_name);
                    Self::emit_progress(app, cat.id(), &file_name, done, paths.len());
                    let data = match out {
                        Ok(data) => data,
                        Err(e) => {
                            crate::commands::emit_log(app, "warn", &format!("Falha ao ler {remote}: {e}"));
                            continue;
                        }
                    };
                    std::fs::write(&local, data).map_err(|e| format!("Falha ao salvar {file_name}: {e}"))?;
                    cat_files += 1;
                    files_copied += 1;
                    done += 1;
                    crate::commands::emit_log(app, "info", &format!("Salvo {file_name}"));
                    continue;
                }

                Self::emit_progress(app, cat.id(), remote, done, paths.len());
                let count = AdbController::list_remote_dir(app, serial, remote).await.unwrap_or(0);
                let output = AdbController::adb_pull(app, serial, remote, &cat_dir.to_string_lossy()).await;
                match output {
                    Ok(()) => {
                        cat_files += count.max(1);
                        files_copied += count.max(1);
                        done += 1;
                        crate::commands::emit_log(app, "ok", &format!("Categoria {} copiada.", cat.label()));
                    }
                    Err(e) => {
                        crate::commands::emit_log(app, "warn", &format!("Categoria {} não copiada: {e}", cat.label()));
                    }
                }
            }
            categories_done.push(cat.id().to_string());
            let _ = cat_files;
        }

        Ok(BackupResult {
            serial: serial.to_string(),
            destination: base.to_string_lossy().to_string(),
            categories_done,
            files_copied,
            message: "Backup concluído".to_string(),
        })
    }

    fn emit_progress(
        app: &AppHandle,
        category: &str,
        file: &str,
        files_done: usize,
        total_files: usize,
    ) {
        use tauri::Emitter;
        let percent = compute_percent(files_done, total_files);
        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                category: category.to_string(),
                file: file.to_string(),
                files_done,
                total_files,
                percent,
            },
        );
    }

    pub async fn restore(
        app: &AppHandle,
        serial: &str,
        destination: &str,
        categories: Vec<String>,
    ) -> Result<BackupResult, String> {
        let mut categories_done = Vec::new();
        let mut files_copied = 0usize;
        let base = std::path::Path::new(destination).join(serial);

        for id in &categories {
            let Some(cat) = BackupCategory::all().into_iter().find(|c| c.id() == id) else {
                continue;
            };
            let cat_dir = base.join(cat.id());

            match cat {
                BackupCategory::Contacts => {
                    let vcf = cat_dir.join("contacts.txt");
                    if vcf.exists() {
                        let out = AdbController::run_shell(
                            app,
                            serial,
                            &["am", "start", "-a", "android.intent.action.VIEW", "-t", "text/x-vcard", "-d", "file:///sdcard/Download/contacts.vcf"],
                        ).await;
                        match out {
                            Ok(_) => {
                                crate::commands::emit_log(app, "ok", "Contatos: abra o arquivo .vcf no aparelho para importar.");
                                categories_done.push(cat.id().to_string());
                            }
                            Err(e) => {
                                crate::commands::emit_log(app, "warn", &format!("Contatos: não foi possível abrir o importador: {e}"));
                            }
                        }
                    }
                }
                BackupCategory::Sms => {
                    let xml = cat_dir.join("sms.txt");
                    if xml.exists() {
                        let out = AdbController::adb_push(app, serial, &xml.to_string_lossy(), "/sdcard/Download/sms.txt").await;
                        match out {
                            Ok(()) => {
                                crate::commands::emit_log(app, "warn", "SMS: restaurar exige o app nativo/Google. O arquivo foi copiado para Download/ no aparelho.");
                                categories_done.push(cat.id().to_string());
                            }
                            Err(e) => {
                                crate::commands::emit_log(app, "warn", &format!("SMS: falha ao copiar arquivo: {e}"));
                            }
                        }
                    }
                }
                _ => {
                    for path in category_to_device_paths(&cat) {
                        let src = cat_dir.join(path.trim_start_matches("/sdcard/").trim_start_matches('/'));
                        if src.exists() {
                            let out = AdbController::adb_push(app, serial, &src.to_string_lossy(), &path).await;
                            match out {
                                Ok(()) => {
                                    files_copied += 1;
                                    crate::commands::emit_log(app, "ok", &format!("Restaurado para {path}"));
                                }
                                Err(e) => {
                                    crate::commands::emit_log(app, "warn", &format!("Falha ao restaurar {path}: {e}"));
                                }
                            }
                        }
                    }
                    categories_done.push(cat.id().to_string());
                }
            }
        }

        Ok(BackupResult {
            serial: serial.to_string(),
            destination: base.to_string_lossy().to_string(),
            categories_done,
            files_copied,
            message: "Restauração concluída".to_string(),
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
