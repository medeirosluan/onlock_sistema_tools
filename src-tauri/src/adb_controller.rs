use std::time::Duration;

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

    pub async fn imei(app: &AppHandle, serial: &str) -> Result<Option<String>, String> {
        let output = Self::run(app, &["-s", serial, "shell", "service", "call", "iphonesubinfo", "1"]).await?;
        Ok(parse_imei(&output))
    }

    pub async fn run_shell(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
        let mut full_args = vec!["-s", serial, "shell"];
        full_args.extend_from_slice(args);
        Self::run(app, &full_args).await
    }

    pub async fn reboot(app: &AppHandle, serial: &str) -> Result<(), String> {
        Self::run(app, &["-s", serial, "reboot"]).await?;
        Ok(())
    }

    pub async fn reboot_bootloader(app: &AppHandle, serial: &str) -> Result<(), String> {
        Self::run(app, &["-s", serial, "reboot", "bootloader"]).await?;
        Ok(())
    }

    pub async fn fastboot(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
        let mut full_args = vec!["-s", serial];
        full_args.extend_from_slice(args);
        Self::run_fastboot(app, &full_args).await
    }

    pub async fn fastboot_long(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
        let mut full_args = vec!["-s", serial];
        full_args.extend_from_slice(args);
        Self::run_fastboot_timeout(app, &full_args, Duration::from_secs(60)).await
    }

    pub async fn fastboot_reboot(app: &AppHandle, serial: &str) -> Result<(), String> {
        Self::run_fastboot(app, &["-s", serial, "reboot"]).await?;
        Ok(())
    }

    async fn run(app: &AppHandle, args: &[&str]) -> Result<String, String> {
        let command = app
            .shell()
            .sidecar("adb")
            .map_err(|e| format!("Erro ao resolver sidecar adb: {e}"))?;
        let output = tokio::time::timeout(
            Duration::from_secs(15),
            command.args(args).output(),
        )
        .await
        .map_err(|_| "adb não respondeu dentro de 15 segundos".to_string())?
        .map_err(|e| format!("Erro ao executar adb: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let message = if stderr.trim().is_empty() {
                "adb retornou erro sem mensagem".to_string()
            } else {
                stderr.to_string()
            };
            return Err(message);
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    async fn run_fastboot(app: &AppHandle, args: &[&str]) -> Result<String, String> {
        Self::run_fastboot_timeout(app, args, Duration::from_secs(15)).await
    }

    async fn run_fastboot_timeout(app: &AppHandle, args: &[&str], timeout: Duration) -> Result<String, String> {
        let command = app
            .shell()
            .sidecar("fastboot")
            .map_err(|e| format!("Erro ao resolver sidecar fastboot: {e}"))?;
        let output = tokio::time::timeout(timeout, command.args(args).output())
            .await
            .map_err(|_| "fastboot não respondeu dentro do tempo limite".to_string())?
            .map_err(|e| format!("Erro ao executar fastboot: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let message = if stderr.trim().is_empty() {
                "fastboot retornou erro sem mensagem".to_string()
            } else {
                stderr.to_string()
            };
            return Err(message);
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

pub fn parse_imei(output: &str) -> Option<String> {
    let mut bytes: Vec<u8> = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        let Some(addr) = line.find("0x") else { continue };
        let Some(colon) = line[addr..].find(':') else { continue };
        let data = &line[addr + colon + 1..];
        let data = data.split('\'').next().unwrap_or(data);
        for token in data.split_whitespace() {
            if token.len() != 8 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
                continue;
            }
            // The dump shows each 4-byte word in big-endian text order, but
            // memory is little-endian: reverse the byte order within the word.
            for i in (0..8).step_by(2).rev() {
                if let Ok(b) = u8::from_str_radix(&token[i..i + 2], 16) {
                    bytes.push(b);
                }
            }
        }
    }

    let mut decoded = String::new();
    for pair in bytes.chunks(2) {
        if pair.len() == 2 && pair[1] == 0 {
            let c = pair[0] as char;
            if c.is_ascii_digit() {
                decoded.push(c);
            }
        }
    }

    let mut best = String::new();
    let mut current = String::new();
    for c in decoded.chars() {
        if c.is_ascii_digit() {
            current.push(c);
        } else if current.len() > best.len() {
            best = std::mem::take(&mut current);
        } else {
            current.clear();
        }
    }
    if current.len() > best.len() {
        best = current;
    }

    if best.len() >= 14 {
        Some(best)
    } else {
        None
    }
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

    const IMEI_OUTPUT: &str = "Result: Parcel(\n  0x00000000: 00000000 0000000f 00360038 00390038 '........8.6.8.9.'\n  0x00000010: 00360037 00350030 00370033 00370035 '7.6.0.5.3.7.5.7.'\n  0x00000020: 00330030 00000037                   '0.3.7...        ')\n";

    #[test]
    fn parse_imei_extracts_utf16_parcel_string() {
        assert_eq!(parse_imei(IMEI_OUTPUT).as_deref(), Some("868976053757037"));
    }

    #[test]
    fn parse_imei_returns_none_for_empty_or_garbage() {
        assert_eq!(parse_imei(""), None);
        assert_eq!(parse_imei("Result: Parcel(\n  0x00000000: ffffffff '........')\n"), None);
    }
}
