use serde::Serialize;
use tauri::AppHandle;

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
