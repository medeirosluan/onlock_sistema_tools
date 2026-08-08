use serde::Serialize;
use tauri::AppHandle;

use crate::adb_controller::AdbController;
use crate::commands::emit_log;

#[derive(Debug, Clone, Serialize)]
pub struct FrpResult {
    pub serial: String,
    pub success: bool,
    pub steps_completed: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrpStep {
    pub id: &'static str,
    pub description: &'static str,
    pub essential: bool,
}

pub fn frp_steps() -> Vec<FrpStep> {
    vec![
        FrpStep {
            id: "verify",
            description: "Verificando acesso ao dispositivo via ADB",
            essential: true,
        },
        FrpStep {
            id: "provision",
            description: "Provisionando o dispositivo (device_provisioned)",
            essential: true,
        },
        FrpStep {
            id: "setup",
            description: "Marcando setup como concluído (user_setup_complete)",
            essential: true,
        },
        FrpStep {
            id: "cleanup",
            description: "Limpando contas vinculadas ao FRP (GMS)",
            essential: false,
        },
        FrpStep {
            id: "done",
            description: "Concluindo remoção de FRP",
            essential: true,
        },
    ]
}

pub fn frp_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> FrpResult {
    FrpResult {
        serial: serial.to_string(),
        success,
        steps_completed,
        message: message.to_string(),
    }
}

pub struct FrpRemover;

impl FrpRemover {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<FrpResult, String> {
        let steps = frp_steps();
        let mut completed = 0;

        for step in &steps {
            emit_log(app, "info", &format!("[FRP] {}", step.description));

            if step.id == "done" {
                emit_log(app, "ok", &format!("[FRP] {} — reinicie o aparelho.", step.description));
                completed += 1;
                break;
            }

            let result = match step.id {
                "verify" => AdbController::getprop(app, serial, "ro.secure").await,
                "provision" => AdbController::run_shell(
                    app,
                    serial,
                    &["settings", "put", "global", "device_provisioned", "1"],
                )
                .await,
                "setup" => AdbController::run_shell(
                    app,
                    serial,
                    &["settings", "put", "secure", "user_setup_complete", "1"],
                )
                .await,
                "cleanup" => {
                    AdbController::run_shell(app, serial, &["pm", "clear", "com.google.android.gms"]).await
                }
                _ => continue,
            };

            match result {
                Ok(_) => {
                    if step.id == "cleanup" {
                        emit_log(app, "ok", "[FRP] Contas limpas.");
                    }
                    completed += 1;
                }
                Err(e) => {
                    if step.essential {
                        emit_log(app, "error", &format!("[FRP] {} falhou: {e}", step.description));
                        return Err(format!("Falha em '{}' no dispositivo {serial}: {e}", step.id));
                    }
                    emit_log(app, "warn", &format!("[FRP] {} não disponível: {e}", step.description));
                }
            }
        }

        Ok(frp_result(serial, true, completed, "FRP removido — reinicie o aparelho"))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BootloaderResult {
    pub serial: String,
    pub success: bool,
    pub steps_completed: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootloaderStep {
    pub id: &'static str,
    pub description: &'static str,
    pub essential: bool,
}

pub fn bootloader_steps() -> Vec<BootloaderStep> {
    vec![
        BootloaderStep {
            id: "fastboot",
            description: "Entrando em modo fastboot",
            essential: true,
        },
        BootloaderStep {
            id: "verify",
            description: "Verificando estado do bootloader",
            essential: true,
        },
        BootloaderStep {
            id: "unlock",
            description: "Executando desbloqueio do bootloader",
            essential: true,
        },
        BootloaderStep {
            id: "confirm",
            description: "Confirmando estado desbloqueado",
            essential: true,
        },
        BootloaderStep {
            id: "done",
            description: "Concluindo desbloqueio do bootloader",
            essential: true,
        },
    ]
}

pub fn bootloader_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> BootloaderResult {
    BootloaderResult {
        serial: serial.to_string(),
        success,
        steps_completed,
        message: message.to_string(),
    }
}

pub fn is_bootloader_unlocked(output: &str) -> bool {
    output.lines().any(|line| {
        let line = line.trim().to_lowercase();
        line.contains("unlocked") && (line.contains("yes") || line.contains("true"))
    })
}

pub struct BootloaderUnlocker;

impl BootloaderUnlocker {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<BootloaderResult, String> {
        let steps = bootloader_steps();
        let mut completed = 0;

        for step in &steps {
            emit_log(app, "info", &format!("[BOOT] {}", step.description));

            if step.id == "done" {
                emit_log(app, "ok", &format!("[BOOT] {} — reinicie o aparelho.", step.description));
                completed += 1;
                break;
            }

            let result = match step.id {
                "fastboot" => AdbController::reboot_bootloader(app, serial).await.map(|_| String::new()),
                "verify" => {
                    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                    let out = AdbController::fastboot(app, serial, &["getvar", "unlocked"]).await;
                    if let Ok(ref out) = out {
                        if is_bootloader_unlocked(out) {
                            emit_log(app, "info", "Bootloader já está desbloqueado.");
                            return Ok(bootloader_result(
                                serial,
                                true,
                                1,
                                "Bootloader já está desbloqueado",
                            ));
                        }
                    }
                    out
                }
                "unlock" => {
                    emit_log(app, "info", "Se o aparelho solicitar, confirme o desbloqueio na tela do aparelho.");
                    match AdbController::fastboot_long(app, serial, &["flashing", "unlock"]).await {
                        Ok(o) => Ok(o),
                        Err(first_err) => {
                            emit_log(app, "warn", &format!("flashing unlock falhou, tentando oem unlock: {first_err}"));
                            AdbController::fastboot_long(app, serial, &["oem", "unlock"]).await
                        }
                    }
                }
                "confirm" => {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    let out = AdbController::fastboot(app, serial, &["getvar", "unlocked"]).await?;
                    if is_bootloader_unlocked(&out) {
                        emit_log(app, "ok", "Bootloader confirmado como desbloqueado.");
                        Ok(String::new())
                    } else {
                        Err("bootloader ainda não está desbloqueado".to_string())
                    }
                }
                _ => continue,
            };

            match result {
                Ok(_) => {
                    completed += 1;
                }
                Err(e) => {
                    emit_log(app, "error", &format!("[BOOT] {} falhou: {e}", step.description));
                    return Err(format!("Falha em '{}' no dispositivo {serial}: {e}", step.id));
                }
            }
        }

        Ok(bootloader_result(serial, true, completed, "Bootloader desbloqueado — reinicie o aparelho"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frp_steps_has_five_ptbr_steps() {
        let steps = frp_steps();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0].id, "verify");
        assert_eq!(steps[1].id, "provision");
        assert_eq!(steps[2].id, "setup");
        assert_eq!(steps[3].id, "cleanup");
        assert_eq!(steps[4].id, "done");
        assert!(steps[0].essential);
        assert!(steps[1].essential);
        assert!(steps[2].essential);
        assert!(!steps[3].essential);
        assert!(steps[4].essential);
        for step in &steps {
            assert!(!step.description.is_empty());
            assert!(step.description.chars().all(|c| !c.is_ascii_control()));
        }
    }

    #[test]
    fn frp_result_assembles_success() {
        let r = frp_result("ROJNKFZ57XJFD6N7", true, 5, "FRP removido");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.steps_completed, 5);
        assert_eq!(r.message, "FRP removido");
    }

    #[test]
    fn frp_result_assembles_failure() {
        let r = frp_result("ROJNKFZ57XJFD6N7", false, 1, "Verificação falhou");
        assert!(!r.success);
        assert_eq!(r.steps_completed, 1);
        assert_eq!(r.message, "Verificação falhou");
    }

    #[test]
    fn bootloader_steps_has_five_ptbr_steps() {
        let steps = bootloader_steps();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0].id, "fastboot");
        assert_eq!(steps[1].id, "verify");
        assert_eq!(steps[2].id, "unlock");
        assert_eq!(steps[3].id, "confirm");
        assert_eq!(steps[4].id, "done");
        for step in &steps {
            assert!(step.essential);
            assert!(!step.description.is_empty());
        }
    }

    #[test]
    fn bootloader_result_assembles_success() {
        let r = bootloader_result("ROJNKFZ57XJFD6N7", true, 5, "Bootloader desbloqueado");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.steps_completed, 5);
        assert_eq!(r.message, "Bootloader desbloqueado");
    }

    #[test]
    fn bootloader_result_assembles_failure() {
        let r = bootloader_result("ROJNKFZ57XJFD6N7", false, 1, "Verificação falhou");
        assert!(!r.success);
        assert_eq!(r.steps_completed, 1);
    }

    #[test]
    fn is_bootloader_unlocked_detects_unlocked() {
        assert!(is_bootloader_unlocked("unlocked: yes\n"));
        assert!(is_bootloader_unlocked("  (bootloader) unlocked: yes"));
        assert!(is_bootloader_unlocked("unlocked:true"));
    }

    #[test]
    fn is_bootloader_unlocked_detects_locked() {
        assert!(!is_bootloader_unlocked("unlocked: no\n"));
        assert!(!is_bootloader_unlocked("  (bootloader) unlocked: no"));
        assert!(!is_bootloader_unlocked(""));
        assert!(!is_bootloader_unlocked("error: cannot get unlocked state"));
    }
}
