use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub model: String,
    pub brand: String,
    pub serial: String,
    pub android_version: String,
    pub platform: String,
    pub connected: bool,
    pub battery: u8,
    pub imei: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AdbSimulator;

impl AdbSimulator {
    pub fn detect(&self, platform: &str) -> DeviceInfo {
        simulate_detect(platform)
    }
}

pub fn simulate_detect(platform: &str) -> DeviceInfo {
    let mut device = DeviceInfo {
        model: String::new(),
        brand: String::new(),
        serial: String::new(),
        android_version: String::new(),
        platform: platform.to_string(),
        connected: true,
        battery: 0,
        imei: String::new(),
    };

    match platform {
        "samsung" => {
            device.model = "SM-A546E".into();
            device.brand = "Samsung".into();
            device.serial = "RZ8T30A00001".into();
            device.android_version = "13".into();
            device.battery = 84;
            device.imei = "351234567890123".into();
        }
        "xiaomi" => {
            device.model = "Redmi Note 12".into();
            device.brand = "Xiaomi".into();
            device.serial = "HMNWLJ00002".into();
            device.android_version = "13".into();
            device.battery = 71;
            device.imei = "353456789012345".into();
        }
        "qualcomm" => {
            device.model = "Pixel 7".into();
            device.brand = "Google".into();
            device.serial = "7F5YH000003".into();
            device.android_version = "14".into();
            device.battery = 92;
            device.imei = "356789012345678".into();
        }
        "mtk" => {
            device.model = "Redmi 10A".into();
            device.brand = "Xiaomi".into();
            device.serial = "RZE3W000004".into();
            device.android_version = "12".into();
            device.battery = 63;
            device.imei = "359012345678901".into();
        }
        _ => {
            device.connected = false;
        }
    }

    device
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samsung_device_is_detected() {
        let d = simulate_detect("samsung");
        assert!(d.connected);
        assert_eq!(d.brand, "Samsung");
        assert!(!d.model.is_empty());
        assert!(!d.serial.is_empty());
        assert_eq!(d.platform, "samsung");
    }

    #[test]
    fn all_supported_platforms_are_detected() {
        for p in ["samsung", "xiaomi", "qualcomm", "mtk"] {
            let d = simulate_detect(p);
            assert!(d.connected, "platform {p} should be connected");
            assert!(!d.model.is_empty(), "platform {p} should have a model");
            assert!(!d.imei.is_empty(), "platform {p} should have an imei");
            assert_eq!(d.platform, p);
        }
    }

    #[test]
    fn unknown_platform_is_disconnected() {
        let d = simulate_detect("unknown");
        assert!(!d.connected);
        assert!(d.model.is_empty());
        assert_eq!(d.platform, "unknown");
    }
}
