# OnLock Suite — Detecção Multi-Modo de Conexão (ADB + Fastboot + MTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-mode connection detection (ADB / Fastboot / MTP) so the app can identify a device even when ADB is inactive (e.g. a Motorola in MTP), show the mode in the TopBar, adapt the panel operations per mode, and let MTP devices reboot to fastboot (via adb or a manual guide).

**Architecture:** New `detect_connection_mode` command in `commands.rs` consolidating ADB (`adb devices`), Fastboot (`fastboot devices`), and MTP (PowerShell `Get-PnpDevice -Class WPD`) with pure testable classifiers/parsers. Frontend gains `useConnectionMode` hook (3s polling), a TopBar mode badge, and per-mode panel adaptation in `DevicePanel`.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecars), React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. Reuse existing adb/fastboot sidecars and `AdbController`. No new Rust deps (MTP via subprocess PowerShell).
- New command: `detect_connection_mode() -> Result<ConnectionInfo, String>`.
- `ConnectionMode` enum: `Adb` | `Fastboot` | `Mtp` | `None` (Debug, Clone, Serialize, Deserialize, PartialEq). `ConnectionInfo { mode, device: Option<String>, serial: Option<String>, detail: String }` (Serialize). `UsbDevice { vid: String, name: String }` (Debug, Clone, Serialize, PartialEq).
- Pure parsers: `classify_connection(adb, fastboot, usb_devices) -> ConnectionInfo` (priority ADB > Fastboot > MTP > None), `parse_wpd_devices(output) -> Vec<UsbDevice>`, `parse_fastboot_devices(output) -> Vec<String>`.
- MTP detection: subprocess PowerShell `Get-PnpDevice -PresentOnly -Class WPD`; a mobile device is any WPD with a known cellular VID (22B8 Motorola, 18D1 Google, 2717 Xiaomi, 04E8 Samsung, 0E8D MediaTek, 12D1 Huawei, 05C6 Qualcomm, 1004 LG, 1F0A HTC, 413C Dell, 19D2 ZTE).
- Fastboot panel: Format Userdata, Reboot, Detectar estado (getvar unlocked). MTP panel: "Reboot Fastboot" (tries adb, falls back to manual guide modal). ADB panel unchanged.
- Polling of 3s. UI pt-BR. Tests only in Rust (3 parsers). No comments unless required.

---

### Task 1: Backend — parsers/classifier (TDD) in `commands.rs`

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `ConnectionMode`, `UsbDevice`, `ConnectionInfo` structs + 3 parsers + tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub enum ConnectionMode { Adb, Fastboot, Mtp, None }` (Debug, Clone, Serialize, Deserialize, PartialEq)
  - `pub struct UsbDevice { pub vid: String, pub name: String }` (Debug, Clone, Serialize, PartialEq)
  - `pub struct ConnectionInfo { pub mode: ConnectionMode, pub device: Option<String>, pub serial: Option<String>, pub detail: String }` (Debug, Clone, Serialize)
  - `fn classify_connection(adb_output: &str, fastboot_output: &str, usb_devices: &[UsbDevice]) -> ConnectionInfo`
  - `fn parse_wpd_devices(output: &str) -> Vec<UsbDevice>`
  - `fn parse_fastboot_devices(output: &str) -> Vec<String>`

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Append to `src-tauri/src/commands.rs` (after the `parse_df` removal — verify the file structure first; place after `manage_apps` and before `clear_logs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionMode {
    Adb,
    Fastboot,
    Mtp,
    None,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UsbDevice {
    pub vid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub mode: ConnectionMode,
    pub device: Option<String>,
    pub serial: Option<String>,
    pub detail: String,
}

fn classify_connection(
    _adb_output: &str,
    _fastboot_output: &str,
    _usb_devices: &[UsbDevice],
) -> ConnectionInfo {
    ConnectionInfo {
        mode: ConnectionMode::None,
        device: None,
        serial: None,
        detail: String::new(),
    }
}

fn parse_wpd_devices(_output: &str) -> Vec<UsbDevice> {
    Vec::new()
}

fn parse_fastboot_devices(_output: &str) -> Vec<String> {
    Vec::new()
}
```

Append to the existing `#[cfg(test)] mod tests` block in `commands.rs`:

```rust
    const CELLULAR_VID: &[&str] = &[
        "22B8", "18D1", "2717", "04E8", "0E8D", "12D1", "05C6", "1004", "1F0A", "413C", "19D2",
    ];

    #[test]
    fn classify_prefers_adb() {
        let info = classify_connection(
            "List of devices attached\nRZ8T30A00001\tdevice product:a55x\n",
            "",
            &[],
        );
        assert_eq!(info.mode, ConnectionMode::Adb);
        assert_eq!(info.serial.as_deref(), Some("RZ8T30A00001"));
    }

    #[test]
    fn classify_fastboot_when_no_adb() {
        let info = classify_connection("", "ROJNKFZ57XJFD6N7\tfastboot\n", &[]);
        assert_eq!(info.mode, ConnectionMode::Fastboot);
        assert_eq!(info.serial.as_deref(), Some("ROJNKFZ57XJFD6N7"));
    }

    #[test]
    fn classify_mtp_when_only_usb() {
        let info = classify_connection(
            "",
            "",
            &[UsbDevice { vid: "22B8".to_string(), name: "motorola one macro".to_string() }],
        );
        assert_eq!(info.mode, ConnectionMode::Mtp);
        assert_eq!(info.device.as_deref(), Some("motorola one macro"));
    }

    #[test]
    fn classify_none_when_nothing() {
        let info = classify_connection("", "", &[]);
        assert_eq!(info.mode, ConnectionMode::None);
    }

    #[test]
    fn classify_ignores_non_cellular_usb() {
        let info = classify_connection(
            "",
            "",
            &[UsbDevice { vid: "8087".to_string(), name: "Bluetooth".to_string() }],
        );
        assert_eq!(info.mode, ConnectionMode::None);
    }

    #[test]
    fn parse_wpd_devices_extracts_name_and_vid() {
        let output = "FriendlyName: motorola one macro\nInstanceId: USB\\VID_22B8&PID_2E82\\ZF523278ZG\nFriendlyName: Dispositivo de Entrada USB\nInstanceId: USB\\VID_8087&PID_0AAA\\5&242A2F40&0&10\n";
        let devices = parse_wpd_devices(output);
        assert!(devices.iter().any(|d| d.vid == "22B8" && d.name.contains("motorola")));
        assert!(devices.iter().any(|d| d.vid == "8087"));
    }

    #[test]
    fn parse_fastboot_devices_extracts_serials() {
        let output = "ROJNKFZ57XJFD6N7\tfastboot\nRZ8T30A00001\tfastboot\n";
        let serials = parse_fastboot_devices(output);
        assert!(serials.contains(&"ROJNKFZ57XJFD6N7".to_string()));
        assert!(serials.contains(&"RZ8T30A00001".to_string()));
    }
```

Note: `ConnectionMode` derives `PartialEq` (needed for `assert_eq!`). The `CELLULAR_VID` const is used by `classify_connection` — define it at module level (not inside tests) since `classify_connection` needs it. Put `const CELLULAR_VID: &[&str]` above the parser functions.

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test classify
cargo test parse_wpd
cargo test parse_fastboot
```
Expected: FAIL — parsers return empty/None.

- [ ] **Step 3: Implement the parsers**

```rust
const CELLULAR_VID: &[&str] = &[
    "22B8", "18D1", "2717", "04E8", "0E8D", "12D1", "05C6", "1004", "1F0A", "413C", "19D2",
];

fn classify_connection(
    adb_output: &str,
    fastboot_output: &str,
    usb_devices: &[UsbDevice],
) -> ConnectionInfo {
    for line in adb_output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 2 && fields[1] == "device" {
            return ConnectionInfo {
                mode: ConnectionMode::Adb,
                serial: Some(fields[0].to_string()),
                device: None,
                detail: format!("ADB: {}", fields[0]),
            };
        }
    }

    let fastboot_serials = parse_fastboot_devices(fastboot_output);
    if let Some(serial) = fastboot_serials.first() {
        return ConnectionInfo {
            mode: ConnectionMode::Fastboot,
            serial: Some(serial.clone()),
            device: None,
            detail: format!("Fastboot: {serial}"),
        };
    }

    for device in usb_devices {
        if CELLULAR_VID.contains(&device.vid.as_str()) {
            return ConnectionInfo {
                mode: ConnectionMode::Mtp,
                serial: None,
                device: Some(device.name.clone()),
                detail: format!("MTP: {}", device.name),
            };
        }
    }

    ConnectionInfo {
        mode: ConnectionMode::None,
        device: None,
        serial: None,
        detail: "Nenhum aparelho detectado".to_string(),
    }
}

fn parse_wpd_devices(output: &str) -> Vec<UsbDevice> {
    let mut devices = Vec::new();
    let mut current_name = String::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some(name) = line.strip_prefix("FriendlyName:") {
            current_name = name.trim().to_string();
        } else if let Some(inst) = line.strip_prefix("InstanceId:") {
            let inst = inst.trim();
            let vid = inst
                .split("VID_")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .unwrap_or_default()
                .to_string();
            if !vid.is_empty() {
                devices.push(UsbDevice {
                    vid,
                    name: current_name.clone(),
                });
            }
            current_name.clear();
        }
    }
    devices
}

fn parse_fastboot_devices(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.split_whitespace().next().unwrap_or_default().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 39 tests (7 new + 32 existing).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/commands.rs
git commit -m "feat(modes): add connection mode parsers and classifier"
```

---

### Task 2: Backend — `detect_connection_mode` command + MTP via PowerShell + register

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `detect_connection_mode`, `get_wpd_devices`, `run_powershell`)
- Modify: `src-tauri/src/lib.rs` (register)

**Interfaces:**
- Consumes: `ConnectionMode`/`UsbDevice`/`ConnectionInfo` + parsers (Task 1), `AdbController::{list_devices, fastboot}` (existing).
- Produces:
  - `pub async fn detect_connection_mode(app: AppHandle) -> Result<ConnectionInfo, String>`
  - `fn get_wpd_devices() -> Vec<UsbDevice>` (sync, uses subprocess PowerShell)
  - `fn run_powershell(script: &str) -> Result<String, String>`

- [ ] **Step 1: Add the PowerShell helper + `get_wpd_devices`**

```rust
fn run_powershell(script: &str) -> Result<String, String> {
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .map_err(|e| format!("Erro ao executar PowerShell: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell falhou: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn get_wpd_devices() -> Vec<UsbDevice> {
    let script = "Get-PnpDevice -PresentOnly -Class WPD | Select-Object FriendlyName, InstanceId | Format-List";
    match run_powershell(script) {
        Ok(output) => parse_wpd_devices(&output),
        Err(_) => Vec::new(),
    }
}
```

- [ ] **Step 2: Add the `detect_connection_mode` command**

```rust
#[tauri::command]
pub async fn detect_connection_mode(app: AppHandle) -> Result<ConnectionInfo, String> {
    let adb_output = AdbController::list_devices(&app)
        .await
        .map_err(|e| format!("Falha ao verificar ADB: {e}"))?;
    let adb_text = adb_output
        .iter()
        .map(|d| format!("{}\t{}", d.serial, d.state))
        .collect::<Vec<_>>()
        .join("\n");

    let fastboot_text = AdbController::fastboot(&app, "", &["devices"])
        .await
        .unwrap_or_default();

    let usb_devices = get_wpd_devices();

    let info = classify_connection(&adb_text, &fastboot_text, &usb_devices);
    match info.mode {
        ConnectionMode::Adb => {
            emit_log(&app, "info", &format!("Modo ADB: {:?}", info.serial));
        }
        ConnectionMode::Fastboot => {
            emit_log(&app, "info", &format!("Modo Fastboot: {:?}", info.serial));
        }
        ConnectionMode::Mtp => {
            emit_log(&app, "warn", &format!("Modo MTP: {:?}", info.device));
        }
        ConnectionMode::None => {
            emit_log(&app, "info", "Nenhum aparelho detectado.");
        }
    }
    Ok(info)
}
```

Note: `AdbController::list_devices` returns `Vec<AdbDevice>`. Building the `adb_text` from it is fine — the classifier's ADB branch checks `fields[1] == "device"` which matches the `serial\tstate` format. `AdbController::fastboot(&app, "", &["devices"])` reuses the existing helper (empty serial is ignored by `fastboot devices`).

- [ ] **Step 3: Register in `lib.rs`**

Add `commands::detect_connection_mode,` to the `invoke_handler` list.

- [ ] **Step 4: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 39 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri
git commit -m "feat(modes): add detect connection mode command with mtp detection"
```

---

### Task 3: Frontend — types, IPC wrapper, `useConnectionMode` hook

**Files:**
- Modify: `src/types.ts` (add `ConnectionMode`, `ConnectionInfo`)
- Modify: `src/lib/ipc.ts` (add `detectConnectionMode`)
- Create: `src/hooks/useConnectionMode.ts`

**Interfaces:**
- Consumes: backend command from Task 2.
- Produces:
  - `types.ts`: `ConnectionMode = "Adb" | "Fastboot" | "Mtp" | "None"`; `ConnectionInfo`.
  - `ipc.ts`: `detectConnectionMode(): Promise<ConnectionInfo>`.
  - `useConnectionMode.ts`: `{ mode, device, serial, loading, error, refresh }` — 3s polling.

- [ ] **Step 1: Add types to `src/types.ts`**

Append:

```ts
export type ConnectionMode = "Adb" | "Fastboot" | "Mtp" | "None";

export interface ConnectionInfo {
  mode: ConnectionMode;
  device: string | null;
  serial: string | null;
  detail: string;
}
```

- [ ] **Step 2: Add IPC wrapper to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, AppInfo, BackupCategory, BackupProgress, BackupResult, BootloaderResult, ConnectionInfo, DeviceInfo, FormatResult, FrpResult, FrpStatus, LogEntry, ManageAppsResult } from "../types";

export const detectConnectionMode = (): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("detect_connection_mode");
```

- [ ] **Step 3: Create `src/hooks/useConnectionMode.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { ConnectionInfo } from "../types";
import { detectConnectionMode } from "../lib/ipc";

export function useConnectionMode() {
  const [info, setInfo] = useState<ConnectionInfo>({
    mode: "None",
    device: null,
    serial: null,
    detail: "Nenhum aparelho detectado",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInfo(await detectConnectionMode());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    mode: info.mode,
    device: info.device,
    serial: info.serial,
    detail: info.detail,
    loading,
    error,
    refresh,
  };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useConnectionMode.ts
git commit -m "feat(frontend): add connection mode hook with polling"
```

---

### Task 4: Frontend — TopBar mode badge + App wiring

**Files:**
- Modify: `src/components/TopBar.tsx` (add mode badge + device name)
- Modify: `src/App.tsx` (use `useConnectionMode`, pass mode to TopBar + DevicePanel)

**Interfaces:**
- Consumes: `useConnectionMode` (Task 3), existing `useDevices`/`useAdbStatus`.
- Produces: mode badge in TopBar; `mode` prop threaded to `DevicePanel`.

- [ ] **Step 1: Update `TopBar.tsx`**

Add `ConnectionMode` to imports, add a `mode` + `deviceName` prop, render a badge:

```tsx
import type { AdbStatus, ConnectionMode } from "../types";

interface Props {
  status: AdbStatus;
  deviceCount: number;
  mode: ConnectionMode;
  deviceName: string | null;
  onRefresh: () => void;
}

const MODE_STYLE: Record<ConnectionMode, string> = {
  Adb: "bg-log-ok text-black",
  Fastboot: "bg-accent-samsung text-white",
  Mtp: "bg-log-warn text-black",
  None: "bg-border text-muted",
};

const MODE_LABEL: Record<ConnectionMode, string> = {
  Adb: "ADB",
  Fastboot: "Fastboot",
  Mtp: "MTP",
  None: "",
};
```

In the header (after the deviceCount span, before the user avatar), add:

```tsx
        {mode !== "None" && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${MODE_STYLE[mode]}`}>
            {MODE_LABEL[mode]}
          </span>
        )}
        {deviceName && mode !== "None" && (
          <span className="hidden text-sm text-muted lg:inline">{deviceName}</span>
        )}
```

- [ ] **Step 2: Update `App.tsx`**

Add the hook and thread mode to TopBar + DevicePanel:

```tsx
import { useConnectionMode } from "./hooks/useConnectionMode";
```

In the component body:

```tsx
  const { mode: connectionMode, device: connectionDevice } = useConnectionMode();
```

Pass to TopBar:

```tsx
      <TopBar
        status={status}
        deviceCount={onlineDevices.length}
        mode={connectionMode}
        deviceName={connectionDevice}
        onRefresh={handleDetect}
      />
```

Pass `connectionMode` to DevicePanel as a new prop (Task 5 uses it):

```tsx
      <DevicePanel
        platform={activePlatform}
        device={deviceInfo}
        loading={loading}
        error={error}
        mode={status.mode}
        connectionMode={connectionMode}
        onDetect={handleDetect}
      />
```

- [ ] **Step 3: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds (DevicePanel may need the `connectionMode` prop added in Task 5 — if Task 4 runs standalone, add a required `connectionMode` prop placeholder in DevicePanel first; better to implement Task 5 in the same pass to keep the build green. If the build fails on the missing prop, proceed to Task 5 before committing this task.)

- [ ] **Step 4: Commit**

```powershell
git add src/components/TopBar.tsx src/App.tsx
git commit -m "feat(frontend): show connection mode badge in top bar"
```

---

### Task 5: Frontend — DevicePanel adapts per mode + MTP manual guide

**Files:**
- Modify: `src/components/DevicePanel.tsx` (accept `connectionMode`, adapt rendering, MTP guide modal)

**Interfaces:**
- Consumes: `ConnectionMode` (Task 3), `useBootloader`/`useFrp` (existing), `rebootBootloader`, `formatUserdata`, `fastbootReboot` (existing ipc).
- Produces: per-mode rendering — Fastboot panel (Format Userdata / Reboot / Detectar estado), MTP panel (Reboot Fastboot + manual guide modal), ADB unchanged.

- [ ] **Step 1: Update `DevicePanel.tsx` props + import**

Add `connectionMode` to `Props`:

```tsx
import type { ConnectionMode, DeviceInfo, Platform } from "../types";

interface Props {
  platform: Platform;
  device: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  mode: "real" | "sim";
  connectionMode: ConnectionMode;
  onDetect: () => void;
}
```

Destructure `connectionMode` in the function signature.

- [ ] **Step 2: Add the MTP guide modal state + Fastboot handlers**

Add state:

```tsx
  const [mtpGuideOpen, setMtpGuideOpen] = useState(false);
  const [fastbootDetecting, setFastbootDetecting] = useState(false);
```

Add a handler for "Reboot Fastboot" in MTP mode (tries adb, falls back to guide):

```tsx
  const handleMtpReboot = async () => {
    try {
      await rebootBootloader(device!.serial);
    } catch {
      setMtpGuideOpen(true);
    }
  };
```

Add a handler for "Detectar estado" in Fastboot mode:

```tsx
  const handleFastbootGetvar = async () => {
    setFastbootDetecting(true);
    try {
      await unlockBootloader(device!.serial);
    } catch {
      // erro já logado pelo backend
    } finally {
      setFastbootDetecting(false);
    }
  };
```

Add the imports needed:

```tsx
import { formatUserdata, fastbootReboot, rebootBootloader, unlockBootloader } from "../lib/ipc";
```

- [ ] **Step 3: Render per-mode content**

In the return, before the ADB-only device cards block, add mode-specific rendering. When `connectionMode === "Fastboot"`:

```tsx
      {connectionMode === "Fastboot" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            onClick={() => setFormatOpen(true)}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Format Userdata
          </button>
          <button
            onClick={() => fastbootReboot(device?.serial ?? "")}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Reboot
          </button>
          <button
            onClick={handleFastbootGetvar}
            disabled={fastbootDetecting}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border disabled:opacity-50"
          >
            {fastbootDetecting ? "Verificando..." : "Detectar estado"}
          </button>
        </div>
      )}
```

When `connectionMode === "Mtp"`:

```tsx
      {connectionMode === "Mtp" && (
        <div className="rounded border border-border bg-panel p-4">
          <h3 className="text-sm font-semibold text-fg">Aparelho em modo MTP</h3>
          <p className="mt-1 text-xs text-muted">
            A Depuração USB está desativada. Ative-a nas Opções de Desenvolvedor para operações avançadas,
            ou reinicie em modo fastboot.
          </p>
          <button
            onClick={handleMtpReboot}
            className="mt-3 rounded border border-border px-4 py-2 text-sm text-fg hover:bg-border"
          >
            Reboot Fastboot
          </button>
        </div>
      )}
```

- [ ] **Step 4: Add the MTP guide modal** (before the closing `</section>`)

```tsx
      {mtpGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Entrar em modo fastboot manualmente</h3>
            <p className="mt-2 text-sm text-muted">Siga os passos no aparelho:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg">
              <li>Desligue o aparelho completamente.</li>
              <li>Mantenha pressionado <strong>Volume Down + Power</strong> juntos.</li>
              <li>Solte quando aparecer a tela de fastboot (robô deitado).</li>
              <li>Conecte o cabo USB novamente.</li>
            </ol>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setMtpGuideOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/components/DevicePanel.tsx
git commit -m "feat(frontend): adapt panel per connection mode with mtp guide"
```

---

### Task 6: End-to-end verification + README

**Files:**
- Modify: `README.md` (document multi-mode detection)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 39 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README:

```markdown
## Detecção Multi-Modo

O app detecta automaticamente o modo de conexão do aparelho (a cada 3 segundos):

- **ADB** — Depuração USB ativa: operações completas.
- **Fastboot** — bootloader: Format Userdata, Reboot, Detectar estado.
- **MTP** — modo de arquivos (ADB inativo): botão "Reboot Fastboot" (tenta via adb; se falhar, mostra o guia manual para entrar em fastboot).
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document multi-mode connection detection"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: the TopBar shows the mode badge (ADB/Fastboot/MTP); the panel adapts per mode; MTP devices show the Reboot Fastboot button + manual guide on failure. Skip if no device — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: parsers/classifier TDD (Task 1), detect_connection_mode + MTP (Task 2), frontend types/ipc/hook (Task 3), TopBar badge + App wiring (Task 4), DevicePanel per-mode (Task 5), verification (Task 6). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `ConnectionMode`/`ConnectionInfo`/`UsbDevice` fields match between `commands.rs` and `types.ts`; `detect_connection_mode` ↔ `detectConnectionMode`; `classify_connection`/`parse_wpd_devices`/`parse_fastboot_devices` markers match Task 2's PowerShell output format; `CELLULAR_VID` used consistently.
