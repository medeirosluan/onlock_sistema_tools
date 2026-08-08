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
}
