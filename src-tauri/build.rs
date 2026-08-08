use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    copy_adb_dlls_sidecar();
}

fn copy_adb_dlls_sidecar() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let source_dir = manifest_dir.join("binaries");
    if !source_dir.exists() {
        return;
    }

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target_dir = match env::var("CARGO_TARGET_DIR") {
        Ok(dir) => PathBuf::from(dir),
        Err(_) => manifest_dir.join("target"),
    };
    let dest_dir = target_dir.join(&profile);

    for dll in ["AdbWinApi.dll", "AdbWinUsbApi.dll"] {
        let src = source_dir.join(dll);
        let dst = dest_dir.join(dll);
        if src.exists() {
            fs::copy(&src, &dst).expect(&format!("falha ao copiar {dll} para o sidecar"));
        }
    }
}
