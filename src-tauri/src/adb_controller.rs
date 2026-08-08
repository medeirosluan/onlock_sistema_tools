use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: Option<String>,
}

pub struct AdbController;

impl AdbController {
    pub async fn start_server(app: &AppHandle) -> Result<(), String> {
        Self::run(app, &["start-server"]).await?;
        Ok(())
    }

    pub async fn list_devices(app: &AppHandle) -> Result<Vec<AdbDevice>, String> {
        let output = Self::run(app, &["devices", "-l"]).await?;
        Ok(parse_devices(&output))
    }

    pub async fn getprop(app: &AppHandle, serial: &str, key: &str) -> Result<String, String> {
        let output = Self::run(app, &["-s", serial, "shell", "getprop", key]).await?;
        Ok(parse_getprop(&output))
    }

    pub async fn battery_level(app: &AppHandle, serial: &str) -> Result<Option<u8>, String> {
        let output = Self::run(app, &["-s", serial, "shell", "dumpsys", "battery"]).await?;
        Ok(parse_battery_level(&output))
    }

    async fn run(app: &AppHandle, args: &[&str]) -> Result<String, String> {
        let command = app
            .shell()
            .sidecar("adb")
            .map_err(|e| format!("Erro ao resolver sidecar adb: {e}"))?;
        let output = command
            .args(args)
            .output()
            .await
            .map_err(|e| format!("Erro ao executar adb: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

pub fn parse_devices(output: &str) -> Vec<AdbDevice> {
    let mut devices = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices") {
            continue;
        }
        let mut fields = line.split_whitespace();
        let serial = fields.next().unwrap_or_default();
        let state = fields.next().unwrap_or_default();
        if serial.is_empty() || state.is_empty() {
            continue;
        }
        let model = fields
            .find_map(|field| field.strip_prefix("model:"))
            .map(|m| m.to_string());
        devices.push(AdbDevice {
            serial: serial.to_string(),
            state: state.to_string(),
            model,
        });
    }
    devices
}

pub fn parse_getprop(output: &str) -> String {
    output.trim().to_string()
}

pub fn map_platform(brand: &str, board_platform: &str) -> String {
    let board = board_platform.to_lowercase();
    if board.starts_with("mt") {
        return "mtk".to_string();
    }
    if board.starts_with("sm") || board.starts_with("sdm") || board.starts_with("msm") {
        return "qualcomm".to_string();
    }
    match brand.to_lowercase().as_str() {
        "samsung" => "samsung".to_string(),
        "xiaomi" | "redmi" | "poco" => "xiaomi".to_string(),
        _ => "unknown".to_string(),
    }
}

pub fn parse_battery_level(output: &str) -> Option<u8> {
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("level:") {
            return rest.trim().parse().ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICES_OUTPUT: &str = "List of devices attached\nRZ8T30A00001\tdevice product:a55x model:SM_A546E device:a55x transport_id:1\n7F5YH000003\tdevice product:husky model:husky device:husky transport_id:2\n\n";

    #[test]
    fn parse_devices_parses_serial_state_and_model() {
        let devices = parse_devices(DEVICES_OUTPUT);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "RZ8T30A00001");
        assert_eq!(devices[0].state, "device");
        assert_eq!(devices[0].model.as_deref(), Some("SM_A546E"));
        assert_eq!(devices[1].serial, "7F5YH000003");
    }

    #[test]
    fn parse_devices_handles_empty_output() {
        assert!(parse_devices("").is_empty());
        assert!(parse_devices("List of devices attached\n\n").is_empty());
    }

    #[test]
    fn parse_getprop_returns_value_or_empty() {
        assert_eq!(parse_getprop("SM-A546E\n"), "SM-A546E");
        assert_eq!(parse_getprop(""), "");
        assert_eq!(parse_getprop("  \n"), "");
    }

    #[test]
    fn map_platform_detects_mtk_board() {
        assert_eq!(map_platform("Xiaomi", "mt6768"), "mtk");
    }

    #[test]
    fn map_platform_detects_qualcomm_board() {
        assert_eq!(map_platform("Samsung", "sm8550"), "qualcomm");
    }

    #[test]
    fn map_platform_detects_samsung_and_xiaomi_by_brand() {
        assert_eq!(map_platform("samsung", ""), "samsung");
        assert_eq!(map_platform("Xiaomi", ""), "xiaomi");
    }

    #[test]
    fn map_platform_defaults_to_unknown() {
        assert_eq!(map_platform("Google", "kirin9000"), "unknown");
    }

    #[test]
    fn parse_battery_level_extracts_level() {
        let output = "Current Battery Service state:\n  AC powered: false\n  level: 84\n  scale: 100\n  status: 2\n";
        assert_eq!(parse_battery_level(output), Some(84));
    }

    #[test]
    fn parse_battery_level_returns_none_when_missing() {
        assert_eq!(parse_battery_level("no battery here"), None);
        assert_eq!(parse_battery_level(""), None);
    }
}
