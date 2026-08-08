# OnLock Suite — Real ADB Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated ADB reads with real integration — adb bundled as a Tauri sidecar, started automatically, listing devices and reading real getprop/battery data into the UI, with the simulator retained as an offline fallback.

**Architecture:** New pure, testable module `adb_controller.rs` (parse functions + `AdbController` that runs the sidecar via `tauri-plugin-shell`). `commands.rs` updated: `detect_device(serial, platform)`, `list_devices()`, `start_adb_server()`. Frontend adds `DeviceSelector`, `useDevices` hook, mode badge (REAL/SIM), device counter, and real-data plumbing.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell 2, tokio, React 18, TypeScript, Tailwind v4, Windows PowerShell + platform-tools from Google.

## Global Constraints

- Tauri 2.x. `externalBin: ["binaries/adb"]` in `tauri.conf.json`. Sidecar binary lives in `src-tauri/binaries/` and is gitignored.
- Sidecar resolved via `Command::new_sidecar("adb")` (shell plugin). No shell capability permission needed — all adb calls are Rust-side (the JS API is not used).
- Commands: `detect_device(serial: String, platform: String) -> Result<DeviceInfo, String>`, `list_devices() -> Result<Vec<AdbDevice>, String>`, `start_adb_server() -> Result<(), String>`. Events unchanged: `log-event`, `logs-cleared`, `adb-status`.
- `AdbStatus` payload gains `mode: String` ("real" | "sim").
- Fallback: if adb unavailable (sidecar missing or server fails), `detect_device` uses `adb_simulator::simulate_detect(platform)` and logs a WARN.
- Log levels: `info`, `ok`, `warn`, `error`. UI language pt-BR.
- Theme tokens unchanged (bg-bg, bg-panel, border-border, text-fg, text-muted, accent/log colors).
- Windows-only binary this phase; code structure ready for multi-platform (no hardcoded platform checks in Rust).
- Tests only in Rust (`adb_controller`, `adb_simulator`); no frontend tests.

---

### Task 1: Sidecar configuration + download script

**Files:**
- Create: `scripts/download-adb.ps1`
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-shell`)
- Modify: `src-tauri/tauri.conf.json` (add `bundle.externalBin`)
- Modify: `.gitignore` (add `src-tauri/binaries/`)
- Modify: `package.json` (add `download:adb` script)

**Interfaces:**
- Consumes: nothing.
- Produces: the `adb` sidecar infrastructure that Tasks 2-3 use (`Command::new_sidecar("adb")` resolves `src-tauri/binaries/adb.exe` at dev time).

- [ ] **Step 1: Add the shell plugin dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:
```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 2: Configure `externalBin`**

In `src-tauri/tauri.conf.json`, add to `bundle`:
```json
"externalBin": [
  "binaries/adb"
]
```

- [ ] **Step 3: Ignore the binary directory**

Append to `.gitignore`:
```
src-tauri/binaries/
```

- [ ] **Step 4: Create the download script**

Create `scripts/download-adb.ps1`:
```powershell
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $repoRoot "src-tauri\binaries"
$tmpZip = Join-Path $env:TEMP "platform-tools-latest-windows.zip"
$tmpDir = Join-Path $env:TEMP "platform-tools-windows"

Write-Host "Baixando platform-tools do Google..."
Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $tmpZip

if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Force (Join-Path $tmpDir "platform-tools\adb.exe") (Join-Path $binDir "adb.exe")
Copy-Item -Force (Join-Path $tmpDir "platform-tools\AdbWinApi.dll") $binDir
Copy-Item -Force (Join-Path $tmpDir "platform-tools\AdbWinUsbApi.dll") $binDir

Write-Host "adb.exe instalado em $binDir"
```

- [ ] **Step 5: Add the npm script**

In `package.json` under `"scripts"`, add:
```json
"download:adb": "powershell -ExecutionPolicy Bypass -File scripts/download-adb.ps1"
```

- [ ] **Step 6: Run the download and verify**

```powershell
npm run download:adb
```
Expected: `src-tauri/binaries/adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` exist.

- [ ] **Step 7: Verify backend still compiles**

Run (workdir = `src-tauri`):
```powershell
cargo check
```
Expected: succeeds (shell plugin may not be used yet — that's fine, it just compiles).

- [ ] **Step 8: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json .gitignore package.json scripts/download-adb.ps1
git commit -m "feat(adb): configure adb sidecar and download script"
```

---

### Task 2: Backend — `adb_controller` module with parse tests (TDD)

**Files:**
- Create: `src-tauri/src/adb_controller.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod adb_controller;`)

**Interfaces:**
- Consumes: Task 1's sidecar config (paths `src-tauri/binaries/adb.exe`).
- Produces:
  - `pub struct AdbDevice { pub serial: String, pub state: String, pub model: Option<String> }` (derive `Debug`, `Clone`, `Serialize`, `PartialEq`)
  - `pub struct AdbController;`
  - `impl AdbController` with async methods taking `&tauri::AppHandle`:
    - `pub async fn start_server(app: &AppHandle) -> Result<(), String>`
    - `pub async fn list_devices(app: &AppHandle) -> Result<Vec<AdbDevice>, String>`
    - `pub async fn getprop(app: &AppHandle, serial: &str, key: &str) -> Result<String, String>`
    - `pub async fn battery_level(app: &AppHandle, serial: &str) -> Result<Option<u8>, String>`
  - Pure functions (testable):
    - `pub fn parse_devices(output: &str) -> Vec<AdbDevice>`
    - `pub fn parse_getprop(output: &str) -> String`
    - `pub fn map_platform(brand: &str, board_platform: &str) -> String`
    - `pub fn parse_battery_level(output: &str) -> Option<u8>`

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Create `src-tauri/src/adb_controller.rs`:

```rust
use serde::Serialize;
use tauri::{AppHandle, Manager};
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
    Vec::new()
}

pub fn parse_getprop(output: &str) -> String {
    String::new()
}

pub fn map_platform(brand: &str, board_platform: &str) -> String {
    String::new()
}

pub fn parse_battery_level(output: &str) -> Option<u8> {
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
```

Add `mod adb_controller;` to the top of `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test adb_controller
```
Expected: FAIL — all parse tests fail (empty/default returns).

- [ ] **Step 3: Implement `parse_devices`**

Replace the `parse_devices` stub:

```rust
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
```

- [ ] **Step 4: Implement `parse_getprop`**

```rust
pub fn parse_getprop(output: &str) -> String {
    output.trim().to_string()
}
```

- [ ] **Step 5: Implement `map_platform`**

```rust
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
```

- [ ] **Step 6: Implement `parse_battery_level`**

```rust
pub fn parse_battery_level(output: &str) -> Option<u8> {
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("level:") {
            return rest.trim().parse().ok();
        }
    }
    None
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 9 new tests + 3 existing (adb_simulator) = 12 passing.

- [ ] **Step 8: Commit**

```powershell
git add src-tauri/src/adb_controller.rs src-tauri/src/lib.rs
git commit -m "feat(adb): add adb controller with device parsing tests"
```

---

### Task 3: Backend — commands, lib wiring, fallback

**Files:**
- Create: none
- Modify: `src-tauri/src/commands.rs` (add `list_devices`, `start_adb_server`; rewrite `detect_device`)
- Modify: `src-tauri/src/lib.rs` (register shell plugin + new commands)

**Interfaces:**
- Consumes: `adb_controller::{AdbController, AdbDevice}`, `adb_simulator::simulate_detect` (Task 2, existing).
- Produces:
  - `pub async fn detect_device(adb: State<'_, AdbSimulator>, app: AppHandle, serial: String, platform: String) -> Result<DeviceInfo, String>`
  - `pub async fn list_devices(app: AppHandle) -> Result<Vec<AdbDevice>, String>`
  - `pub async fn start_adb_server(app: AppHandle) -> Result<(), String>`
  - `adb-status` payload: `AdbStatusPayload { connected: bool, platform: String, mode: String }`

- [ ] **Step 1: Update `commands.rs`**

Replace `detect_device` and add the two new commands. Full updated file:

```rust
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::adb_controller::{AdbController, AdbDevice};
use crate::adb_simulator::{AdbSimulator, DeviceInfo};

#[derive(Debug, Clone, Serialize)]
pub struct LogPayload {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdbStatusPayload {
    pub connected: bool,
    pub platform: String,
    pub mode: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn emit_log(app: &AppHandle, level: &str, message: &str) {
    let payload = LogPayload {
        timestamp: now_ms(),
        level: level.to_string(),
        message: message.to_string(),
    };
    let _ = app.emit("log-event", payload);
}

fn emit_status(app: &AppHandle, connected: bool, platform: String, mode: String) {
    let payload = AdbStatusPayload {
        connected,
        platform,
        mode,
    };
    let _ = app.emit("adb-status", payload);
}

#[tauri::command]
pub async fn start_adb_server(app: AppHandle) -> Result<(), String> {
    emit_log(&app, "info", "Iniciando adb server...");
    match AdbController::start_server(&app).await {
        Ok(()) => {
            emit_log(&app, "ok", "ADB server iniciado.");
            Ok(())
        }
        Err(e) => {
            emit_log(&app, "warn", &format!("ADB indisponível — modo simulação será usado: {e}"));
            emit_status(&app, false, String::new(), "sim".to_string());
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Result<Vec<AdbDevice>, String> {
    AdbController::list_devices(&app).await
}

#[tauri::command]
pub async fn detect_device(
    adb: State<'_, AdbSimulator>,
    app: AppHandle,
    serial: String,
    platform: String,
) -> Result<DeviceInfo, String> {
    emit_log(&app, "info", &format!("Detectando dispositivo {serial}..."));

    let model = AdbController::getprop(&app, &serial, "ro.product.model").await;
    if model.is_err() {
        emit_log(&app, "warn", "Falha ao ler propriedades via ADB — usando modo simulação.");
        let device = adb.detect(&platform);
        emit_status(&app, device.connected, device.platform.clone(), "sim".to_string());
        emit_log(&app, "ok", &format!("Dispositivo (simulação) identificado: {}", device.model));
        return Ok(device);
    }

    let model = model.unwrap();
    emit_log(&app, "info", &format!("Modelo: {model}"));

    let brand = AdbController::getprop(&app, &serial, "ro.product.brand")
        .await
        .unwrap_or_default();
    let android_version = AdbController::getprop(&app, &serial, "ro.build.version.release")
        .await
        .unwrap_or_default();
    let board = AdbController::getprop(&app, &serial, "ro.board.platform")
        .await
        .unwrap_or_default();
    let battery = AdbController::battery_level(&app, &serial)
        .await
        .unwrap_or(None);

    let platform_mapped = crate::adb_controller::map_platform(&brand, &board);
    let device = DeviceInfo {
        model: model.clone(),
        brand,
        serial: serial.clone(),
        android_version,
        platform: platform_mapped,
        connected: true,
        battery: battery.unwrap_or(0),
        imei: String::new(),
    };

    emit_status(&app, true, device.platform.clone(), "real".to_string());
    emit_log(&app, "ok", &format!("Dispositivo identificado: {}", device.model));
    Ok(device)
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<(), String> {
    app.emit("logs-cleared", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

- [ ] **Step 2: Update `lib.rs`**

```rust
mod adb_controller;
mod adb_simulator;
mod commands;

use adb_simulator::AdbSimulator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AdbSimulator)
        .invoke_handler(tauri::generate_handler![
            commands::detect_device,
            commands::list_devices,
            commands::start_adb_server,
            commands::clear_logs,
            commands::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify backend compiles**

Run (workdir = `src-tauri`):
```powershell
cargo check
```
Expected: succeeds. If the shell plugin `Command` API differs (e.g. `command.args(args)` signature), adapt minimally — the semantics are spawn + await output. Note any adaptation in the report.

- [ ] **Step 4: Run all tests**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: 12 tests pass (9 adb_controller + 3 adb_simulator).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri
git commit -m "feat(adb): wire adb commands with simulation fallback"
```

---

### Task 4: Frontend — types, IPC wrappers, hooks

**Files:**
- Modify: `src/types.ts` (add `AdbDevice`, extend `AdbStatus` with `mode`)
- Modify: `src/lib/ipc.ts` (add `listDevices`, `startAdbServer`; change `detectDevice`)
- Create: `src/hooks/useDevices.ts`

**Interfaces:**
- Consumes: backend commands from Task 3.
- Produces:
  - `types.ts`: `interface AdbDevice { serial: string; state: string; model: string | null }`, `interface AdbStatus { connected: boolean; platform: string | null; mode: "real" | "sim" }`
  - `ipc.ts`: `listDevices(): Promise<AdbDevice[]>`, `startAdbServer(): Promise<void>`, `detectDevice(serial: string, platform: string): Promise<DeviceInfo>`
  - `useDevices.ts`: `useDevices() => { devices: AdbDevice[], loading: boolean, error: string | null, refresh: () => Promise<void> }` — calls `startAdbServer` once on mount, then `refresh()`.

- [ ] **Step 1: Update `src/types.ts`**

```ts
export type Platform = "samsung" | "xiaomi" | "qualcomm" | "mtk";

export interface DeviceInfo {
  model: string;
  brand: string;
  serial: string;
  android_version: string;
  platform: string;
  connected: boolean;
  battery: number;
  imei: string;
}

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface AdbStatus {
  connected: boolean;
  platform: string | null;
  mode: "real" | "sim";
}

export interface AdbDevice {
  serial: string;
  state: string;
  model: string | null;
}
```

- [ ] **Step 2: Update `src/lib/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AdbDevice, AdbStatus, DeviceInfo, LogEntry } from "../types";

export const detectDevice = (serial: string, platform: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("detect_device", { serial, platform });

export const listDevices = (): Promise<AdbDevice[]> => invoke<AdbDevice[]>("list_devices");

export const startAdbServer = (): Promise<void> => invoke("start_adb_server");

export const clearLogs = (): Promise<void> => invoke("clear_logs");

export const getAppVersion = (): Promise<string> => invoke<string>("get_app_version");

export const onLogEvent = (cb: (entry: LogEntry) => void): Promise<() => void> =>
  listen<LogEntry>("log-event", (event) => cb(event.payload));

export const onLogsCleared = (cb: () => void): Promise<() => void> =>
  listen("logs-cleared", () => cb());

export const onAdbStatus = (cb: (status: AdbStatus) => void): Promise<() => void> =>
  listen<AdbStatus>("adb-status", (event) => cb(event.payload));
```

- [ ] **Step 3: Create `src/hooks/useDevices.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { AdbDevice } from "../types";
import { listDevices, startAdbServer } from "../lib/ipc";

export function useDevices() {
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await listDevices());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startAdbServer().then(refresh).catch(() => {});
  }, [refresh]);

  return { devices, loading, error, refresh };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds (App.tsx still uses old `detectDevice(activePlatform)` — will be fixed in Task 5).

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useDevices.ts
git commit -m "feat(frontend): add device list ipc and hook"
```

---

### Task 5: Frontend — device selector, panel, topbar, app wiring

**Files:**
- Create: `src/components/DeviceSelector.tsx`
- Modify: `src/App.tsx` (detect flow with selector, real data, mode)
- Modify: `src/components/DevicePanel.tsx` (real data source, error state, mode badge)
- Modify: `src/components/TopBar.tsx` (device counter, mode badge)

**Interfaces:**
- Consumes: `useDevices`, `detectDevice`, `listDevices`, `DeviceInfo`, `AdbDevice`, `AdbStatus` (Tasks 3-4).
- Produces: the updated responsive dark UI wired to real ADB data.

- [ ] **Step 1: Create `src/components/DeviceSelector.tsx`**

```tsx
import type { AdbDevice } from "../types";

interface Props {
  devices: AdbDevice[];
  onSelect: (serial: string) => void;
  onCancel: () => void;
}

export function DeviceSelector({ devices, onSelect, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded border border-border bg-panel p-4">
        <h3 className="text-sm font-semibold text-fg">Selecione um dispositivo</h3>
        <p className="mt-1 text-xs text-muted">{devices.length} dispositivos conectados</p>
        <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {devices.map((device) => (
            <li key={device.serial}>
              <button
                onClick={() => onSelect(device.serial)}
                className="w-full rounded border border-border px-3 py-2 text-left hover:bg-border"
              >
                <p className="font-mono text-sm text-fg">{device.serial}</p>
                {device.model && <p className="text-xs text-muted">{device.model}</p>}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/components/DevicePanel.tsx`**

```tsx
import type { DeviceInfo, Platform } from "../types";

interface Props {
  platform: Platform;
  device: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  mode: "real" | "sim";
  onDetect: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  samsung: "Samsung",
  xiaomi: "Xiaomi",
  qualcomm: "Qualcomm",
  mtk: "MTK",
};

export function DevicePanel({ platform, device, loading, error, mode, onDetect }: Props) {
  const fields = device
    ? [
        ["Modelo", device.model],
        ["Marca", device.brand],
        ["Serial", device.serial],
        ["Versão Android", device.android_version],
        ["Plataforma", device.platform],
        ["Bateria", device.connected ? `${device.battery}%` : "—"],
        ["IMEI", device.imei],
      ]
    : [];

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-fg">{PLATFORM_LABELS[platform]}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              mode === "real" ? "bg-log-ok text-black" : "bg-log-warn text-black"
            }`}
          >
            {mode === "real" ? "Real" : "Sim"}
          </span>
        </div>
        <button
          onClick={onDetect}
          disabled={loading}
          className="rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border disabled:opacity-50"
        >
          {loading ? "Detectando..." : "Detectar dispositivo"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
          {error}
        </div>
      )}

      {mode === "sim" && !device && (
        <p className="text-xs text-muted">
          ADB não encontrado — usando modo simulação. Rode <code className="text-fg">npm run download:adb</code> e reinicie.
        </p>
      )}

      {device?.connected ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded border border-border bg-panel p-3">
              <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
              <p className="mt-1 truncate text-sm text-fg">{value || "—"}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-border">
          <p className="px-4 text-center text-sm text-muted">
            {loading
              ? "Detectando dispositivo..."
              : 'Nenhum dispositivo detectado. Clique em "Detectar dispositivo".'}
          </p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Update `src/components/TopBar.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/ipc";
import type { AdbStatus } from "../types";

interface Props {
  status: AdbStatus;
  deviceCount: number;
  onRefresh: () => void;
}

export function TopBar({ status, deviceCount, onRefresh }: Props) {
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent-samsung font-bold text-white">
          O
        </span>
        <div>
          <h1 className="text-base font-semibold leading-tight text-fg">OnLock Suite</h1>
          <p className="text-xs text-muted">v{version}</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${status.connected ? "bg-log-ok" : "bg-muted"}`}
          />
          <span className="text-sm text-fg">{status.connected ? "Conectado" : "Desconectado"}</span>
        </div>
        <span className="hidden text-sm text-muted md:inline">
          {deviceCount === 0
            ? "Nenhum dispositivo"
            : `${deviceCount} dispositivo${deviceCount > 1 ? "s" : ""}`}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-border text-sm font-semibold text-fg">
            O
          </span>
          <span className="hidden text-sm text-fg sm:inline">Operador</span>
        </div>
        <button
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
        >
          Atualizar
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Update `src/App.tsx`**

```tsx
import { useState } from "react";
import { DevicePanel } from "./components/DevicePanel";
import { DeviceSelector } from "./components/DeviceSelector";
import { LogConsole } from "./components/LogConsole";
import { ManufacturerTabs } from "./components/ManufacturerTabs";
import { TopBar } from "./components/TopBar";
import { useAdbStatus } from "./hooks/useAdbStatus";
import { useDevices } from "./hooks/useDevices";
import { useLogs } from "./hooks/useLogs";
import { detectDevice, listDevices } from "./lib/ipc";
import type { DeviceInfo, Platform } from "./types";

export default function App() {
  const [activePlatform, setActivePlatform] = useState<Platform>("samsung");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const { devices } = useDevices();
  const { logs, clear } = useLogs();
  const status = useAdbStatus();

  const onlineDevices = devices.filter((d) => d.state === "device");

  const runDetect = async (serial: string) => {
    setLoading(true);
    setError(null);
    try {
      const device = await detectDevice(serial, activePlatform);
      setDeviceInfo(device);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    try {
      const list = await listDevices();
      const online = list.filter((d) => d.state === "device");
      if (online.length === 0) {
        setError("Nenhum dispositivo encontrado em ADB.");
        return;
      }
      if (online.length === 1) {
        await runDetect(online[0].serial);
      } else {
        setSelectorOpen(true);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <TopBar status={status} deviceCount={onlineDevices.length} onRefresh={handleDetect} />
      <ManufacturerTabs active={activePlatform} onChange={setActivePlatform} />
      <DevicePanel
        platform={activePlatform}
        device={deviceInfo}
        loading={loading}
        error={error}
        mode={status.mode}
        onDetect={handleDetect}
      />
      <LogConsole logs={logs} onClear={clear} />
      {selectorOpen && (
        <DeviceSelector
          devices={onlineDevices}
          onSelect={(serial) => {
            setSelectorOpen(false);
            runDetect(serial);
          }}
          onCancel={() => setSelectorOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src
git commit -m "feat(frontend): device selector, real data panel and mode badge"
```

---

### Task 6: End-to-end verification + README

**Files:**
- Modify: `README.md` (document download:adb and real vs sim mode)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 12 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the existing README (after the "Comandos do backend" section):

```markdown
## ADB real (sidecar)

O app usa o `adb` real (platform-tools) empacotado como sidecar. Para baixar o binário:

```
npm run download:adb
```

O `adb.exe` (e as DLLs) ficam em `src-tauri/binaries/` (fora do git). O app inicia o adb server automaticamente e lista os dispositivos conectados. Se o adb não estiver disponível, o app usa o modo simulação (badge "SIM" na interface).

Comandos novos:

- `list_devices()` — lista dispositivos via `adb devices -l`.
- `start_adb_server()` — inicia o adb server.
- `detect_device(serial, platform)` — lê propriedades reais (getprop) do dispositivo.
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document adb sidecar usage"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: window opens; "Iniciando adb server..." appears in console; device counter in TopBar shows connected devices; clicking "Detectar dispositivo" reads real data (mode badge "REAL") or, without adb, falls back to simulation (badge "SIM"). Skip if no device/adb available — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: sidecar config (Task 1), adb_controller + parse tests (Task 2), commands + fallback (Task 3), frontend types/ipc/hooks (Task 4), UI (Task 5), verification (Task 6). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `AdbDevice`/`AdbStatus.mode` match between `commands.rs` (`AdbStatusPayload.mode`) and `src/types.ts`; `detect_device(serial, platform)` matches `detectDevice(serial, platform)` in `ipc.ts`; event names unchanged.
