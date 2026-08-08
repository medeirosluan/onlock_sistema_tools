# OnLock Suite â€” PreparaÃ§Ã£o de Revenda (Gerenciamento de Aparelhos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the resale-prep operation set to OnLock Suite: check FRP status, list/disable/remove apps, and generate a device health card â€” as 3 new buttons in the existing `OperationGrid` (Xiaomi/MTK tabs).

**Architecture:** Extend existing modules. `commands.rs` gains `check_frp_status`, `list_apps`, `manage_apps`, `device_health` (reusing `AdbController::run_shell`/`getprop`) with pure testable parsers (`parse_apps`, `parse_frp_pst`, `parse_boolean`). Frontend gains `useResale` hook, 4 IPC wrappers, types, and 3 new OperationGrid buttons (Check FRP, Apps modal, Ficha SaÃºde card).

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecar), React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. Reuse existing `AdbController` helpers. No new deps, no capability changes.
- New commands: `check_frp_status(serial) -> Result<FrpStatus, String>`, `list_apps(serial) -> Result<Vec<AppInfo>, String>`, `manage_apps(serial, packages: Vec<String>, action: String) -> Result<ManageAppsResult, String>`, `device_health(serial) -> Result<DeviceHealth, String>`.
- Structs (Serialize): `FrpStatus { frp_blocked: bool, oem_unlock_allowed: bool, message: String }`, `AppInfo { package: String, system: bool, enabled: bool }`, `ManageAppsResult { processed: usize, failed: Vec<String>, message: String }`, `DeviceHealth { model, imei, android_version, build, total_storage, free_storage, battery, frp_blocked }`.
- Pure parsers: `parse_apps(output: &str) -> Vec<AppInfo>`, `parse_frp_pst(value: &str) -> bool`, `parse_boolean(value: &str) -> bool`.
- `manage_apps` action âˆˆ "disable" (`pm disable-user`) | "uninstall" (`pm uninstall --user 0`).
- UI pt-BR. 3 new buttons in OperationGrid with per-fabricant accent. Check FRP â†’ banner + log; Apps â†’ modal with checkboxes; Ficha SaÃºde â†’ card.
- Tests only in Rust (3 parsers). No unit tests for real adb.
- No comments in code unless required by convention.

---

### Task 1: Backend â€” parsers (TDD) in `commands.rs`

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `FrpStatus`, `AppInfo`, `ManageAppsResult`, `DeviceHealth` structs + 3 parsers + tests)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct FrpStatus { pub frp_blocked: bool, pub oem_unlock_allowed: bool, pub message: String }` (Debug, Clone, Serialize)
  - `pub struct AppInfo { pub package: String, pub system: bool, pub enabled: bool }` (Debug, Clone, Serialize, PartialEq)
  - `pub struct ManageAppsResult { pub processed: usize, pub failed: Vec<String>, pub message: String }` (Debug, Clone, Serialize)
  - `pub struct DeviceHealth { pub model: String, pub imei: String, pub android_version: String, pub build: String, pub total_storage: String, pub free_storage: String, pub battery: u8, pub frp_blocked: bool }` (Debug, Clone, Serialize)
  - `fn parse_apps(output: &str) -> Vec<AppInfo>` (private, tested)
  - `fn parse_frp_pst(value: &str) -> bool` (private, tested)
  - `fn parse_boolean(value: &str) -> bool` (private, tested)

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Append to `src-tauri/src/commands.rs` (after the `format_result` function):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct FrpStatus {
    pub frp_blocked: bool,
    pub oem_unlock_allowed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppInfo {
    pub package: String,
    pub system: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManageAppsResult {
    pub processed: usize,
    pub failed: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceHealth {
    pub model: String,
    pub imei: String,
    pub android_version: String,
    pub build: String,
    pub total_storage: String,
    pub free_storage: String,
    pub battery: u8,
    pub frp_blocked: bool,
}

fn parse_apps(_output: &str) -> Vec<AppInfo> {
    Vec::new()
}

fn parse_frp_pst(_value: &str) -> bool {
    false
}

fn parse_boolean(_value: &str) -> bool {
    false
}
```

Append to the existing `#[cfg(test)] mod tests` block in `commands.rs`:

```rust
    #[test]
    fn parse_apps_combines_user_system_and_disabled() {
        let output = "USER_APPS\npackage:com.example.app\npackage:com.android.chrome\npackage:com.google.android.gms\n";
        let apps = parse_apps(output);
        assert_eq!(apps.len(), 3);
        assert_eq!(apps[0].package, "com.example.app");
        assert!(!apps[0].system);
    }

    #[test]
    fn parse_apps_marks_system_and_disabled() {
        let output = "SYSTEM_APPS\npackage:com.android.settings\nUSER_APPS\npackage:com.example.app\n";
        let apps = parse_apps(output);
        let settings = apps.iter().find(|a| a.package == "com.android.settings").unwrap();
        assert!(settings.system);
        let app = apps.iter().find(|a| a.package == "com.example.app").unwrap();
        assert!(!app.system);
        assert!(app.enabled);
    }

    #[test]
    fn parse_apps_marks_disabled_section() {
        let output = "USER_APPS\npackage:com.example.app\nDISABLED_APPS\npackage:com.disabled.app\n";
        let apps = parse_apps(output);
        let app = apps.iter().find(|a| a.package == "com.example.app").unwrap();
        assert!(app.enabled);
        let disabled = apps.iter().find(|a| a.package == "com.disabled.app").unwrap();
        assert!(!disabled.enabled);
    }

    #[test]
    fn parse_frp_pst_detects_block() {
        assert!(parse_frp_pst("1"));
        assert!(parse_frp_pst("FRP"));
        assert!(!parse_frp_pst(""));
    }

    #[test]
    fn parse_boolean_handles_common_values() {
        assert!(parse_boolean("true"));
        assert!(parse_boolean("1"));
        assert!(!parse_boolean("false"));
        assert!(!parse_boolean("0"));
        assert!(!parse_boolean(""));
    }
```

Note: `parse_apps` is tested with the marker-scheme output (`SYSTEM_APPS`/`USER_APPS`/`DISABLED_APPS`) that Task 2's `list_apps` will assemble. The parser sets the `system` flag from the current marker section; the `enabled` flag defaults to true (the disabled-list refinement is applied in Task 2's assembly, where DISABLED_APPS packages get `enabled: false`).

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test parse
```
Expected: FAIL â€” `parse_apps` returns empty, `parse_boolean` returns false.

- [ ] **Step 3: Implement `parse_apps`, `parse_frp_pst`, `parse_boolean`**

```rust
fn parse_apps(output: &str) -> Vec<AppInfo> {
    let mut apps = Vec::new();
    let mut system = false;
    let mut enabled = true;
    for line in output.lines() {
        let line = line.trim();
        if line.contains("SYSTEM_APPS") {
            system = true;
            continue;
        }
        if line.contains("USER_APPS") {
            system = false;
            continue;
        }
        if line.contains("DISABLED_APPS") {
            system = false;
            enabled = false;
            continue;
        }
        if let Some(pkg) = line.strip_prefix("package:") {
            apps.push(AppInfo {
                package: pkg.to_string(),
                system,
                enabled,
            });
        }
    }
    apps
}

fn parse_frp_pst(value: &str) -> bool {
    !value.trim().is_empty()
}

fn parse_boolean(value: &str) -> bool {
    matches!(value.trim().to_lowercase().as_str(), "true" | "1")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS â€” 32 tests (5 new + 27 existing).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/commands.rs
git commit -m "feat(resale): add parsers for frp, apps and boolean props"
```

---

### Task 2: Backend â€” the 4 resale commands + register in lib.rs

**Files:**
- Modify: `src-tauri/src/commands.rs` (add the 4 commands)
- Modify: `src-tauri/src/lib.rs` (register)

**Interfaces:**
- Consumes: `FrpStatus`/`AppInfo`/`ManageAppsResult`/`DeviceHealth` + parsers (Task 1), `AdbController::{getprop, run_shell, imei, battery_level}` (existing).
- Produces:
  - `pub async fn check_frp_status(app: AppHandle, serial: String) -> Result<FrpStatus, String>`
  - `pub async fn list_apps(app: AppHandle, serial: String) -> Result<Vec<AppInfo>, String>`
  - `pub async fn manage_apps(app: AppHandle, serial: String, packages: Vec<String>, action: String) -> Result<ManageAppsResult, String>`
  - `pub async fn device_health(app: AppHandle, serial: String) -> Result<DeviceHealth, String>`

- [ ] **Step 1: Add `check_frp_status`**

Append before `clear_logs`:

```rust
#[tauri::command]
pub async fn check_frp_status(app: AppHandle, serial: String) -> Result<FrpStatus, String> {
    let frp_value = AdbController::getprop(&app, &serial, "ro.frp.pst")
        .await
        .unwrap_or_default();
    let oem_value = AdbController::getprop(&app, &serial, "sys.oem_unlock_allowed")
        .await
        .unwrap_or_default();
    let frp_blocked = parse_frp_pst(&frp_value);
    let oem_unlock_allowed = parse_boolean(&oem_value);

    if frp_blocked {
        emit_log(&app, "warn", &format!("FRP presente no dispositivo {serial}."));
        Ok(FrpStatus {
            frp_blocked,
            oem_unlock_allowed,
            message: "FRP presente â€” aparelho nÃ£o estÃ¡ limpo para revenda".to_string(),
        })
    } else {
        emit_log(&app, "ok", &format!("FRP limpo no dispositivo {serial}."));
        Ok(FrpStatus {
            frp_blocked,
            oem_unlock_allowed,
            message: "FRP limpo â€” aparelho pronto para revenda".to_string(),
        })
    }
}
```

- [ ] **Step 2: Add `list_apps`**

```rust
#[tauri::command]
pub async fn list_apps(app: AppHandle, serial: String) -> Result<Vec<AppInfo>, String> {
    let user = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-3"])
        .await
        .unwrap_or_default();
    let system = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-s"])
        .await
        .unwrap_or_default();
    let disabled = AdbController::run_shell(&app, &serial, &["pm", "list", "packages", "-d"])
        .await
        .unwrap_or_default();

    let mut combined = String::new();
    combined.push_str("SYSTEM_APPS\n");
    combined.push_str(&system);
    combined.push_str("USER_APPS\n");
    combined.push_str(&user);
    combined.push_str("DISABLED_APPS\n");
    combined.push_str(&disabled);

    let apps = parse_apps(&combined);
    Ok(apps)
}
```

- [ ] **Step 3: Add `manage_apps`**

```rust
#[tauri::command]
pub async fn manage_apps(
    app: AppHandle,
    serial: String,
    packages: Vec<String>,
    action: String,
) -> Result<ManageAppsResult, String> {
    let mut processed = 0usize;
    let mut failed = Vec::new();

    for pkg in &packages {
        let args: &[&str] = match action.as_str() {
            "disable" => &["pm", "disable-user", "--user", "0", pkg],
            "uninstall" => &["pm", "uninstall", "--user", "0", pkg],
            _ => return Err(format!("AÃ§Ã£o invÃ¡lida: {action}. Use 'disable' ou 'uninstall'.")),
        };
        match AdbController::run_shell(&app, &serial, args).await {
            Ok(_) => {
                processed += 1;
                emit_log(&app, "ok", &format!("{action}: {pkg}"));
            }
            Err(e) => {
                failed.push(pkg.clone());
                emit_log(&app, "warn", &format!("{action} falhou em {pkg}: {e}"));
            }
        }
    }

    Ok(ManageAppsResult {
        processed,
        failed,
        message: format!("{action}: {processed} processados, {} falhas", failed.len()),
    })
}
```

- [ ] **Step 4: Add `device_health`**

```rust
#[tauri::command]
pub async fn device_health(app: AppHandle, serial: String) -> Result<DeviceHealth, String> {
    let model = AdbController::getprop(&app, &serial, "ro.product.model")
        .await
        .unwrap_or_default();
    let android_version = AdbController::getprop(&app, &serial, "ro.build.version.release")
        .await
        .unwrap_or_default();
    let build = AdbController::getprop(&app, &serial, "ro.build.display.id")
        .await
        .unwrap_or_default();
    let imei = AdbController::imei(&app, &serial)
        .await
        .unwrap_or(None)
        .unwrap_or_default();
    let battery = AdbController::battery_level(&app, &serial)
        .await
        .unwrap_or(None)
        .unwrap_or(0);
    let frp_value = AdbController::getprop(&app, &serial, "ro.frp.pst")
        .await
        .unwrap_or_default();
    let df = AdbController::run_shell(&app, &serial, &["df", "-h", "/data"])
        .await
        .unwrap_or_default();

    let (total_storage, free_storage) = parse_df(&df);

    Ok(DeviceHealth {
        model,
        imei,
        android_version,
        build,
        total_storage,
        free_storage,
        battery,
        frp_blocked: parse_frp_pst(&frp_value),
    })
}

fn parse_df(output: &str) -> (String, String) {
    for line in output.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 4 {
            return (fields[1].to_string(), fields[3].to_string());
        }
    }
    (String::new(), String::new())
}
```

- [ ] **Step 5: Register the commands in `lib.rs`**

Add `commands::check_frp_status,`, `commands::list_apps,`, `commands::manage_apps,`, `commands::device_health,` to the `invoke_handler` list.

- [ ] **Step 6: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 32 tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri
git commit -m "feat(resale): add frp check, apps list/manage and device health commands"
```

---

### Task 3: Frontend â€” types, IPC wrappers, `useResale` hook

**Files:**
- Modify: `src/types.ts` (add `FrpStatus`, `AppInfo`, `ManageAppsResult`, `DeviceHealth`)
- Modify: `src/lib/ipc.ts` (add 4 wrappers)
- Create: `src/hooks/useResale.ts`

**Interfaces:**
- Consumes: backend commands from Task 2.
- Produces:
  - `types.ts`: the 4 interfaces.
  - `ipc.ts`: `checkFrpStatus(serial)`, `listApps(serial)`, `manageApps(serial, packages, action)`, `deviceHealth(serial)`.
  - `useResale.ts`: `{ frpStatus, apps, health, loading, error, checkFrp, listApps, manageApps, getHealth }`.

- [ ] **Step 1: Add types to `src/types.ts`**

Append:

```ts
export interface FrpStatus {
  frp_blocked: boolean;
  oem_unlock_allowed: boolean;
  message: string;
}

export interface AppInfo {
  package: string;
  system: boolean;
  enabled: boolean;
}

export interface ManageAppsResult {
  processed: number;
  failed: string[];
  message: string;
}

export interface DeviceHealth {
  model: string;
  imei: string;
  android_version: string;
  build: string;
  total_storage: string;
  free_storage: string;
  battery: number;
  frp_blocked: boolean;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, AppInfo, BackupCategory, BackupProgress, BackupResult, BootloaderResult, DeviceHealth, DeviceInfo, FormatResult, FrpResult, FrpStatus, LogEntry, ManageAppsResult } from "../types";

export const checkFrpStatus = (serial: string): Promise<FrpStatus> =>
  invoke<FrpStatus>("check_frp_status", { serial });

export const listApps = (serial: string): Promise<AppInfo[]> =>
  invoke<AppInfo[]>("list_apps", { serial });

export const manageApps = (
  serial: string,
  packages: string[],
  action: "disable" | "uninstall",
): Promise<ManageAppsResult> => invoke<ManageAppsResult>("manage_apps", { serial, packages, action });

export const deviceHealth = (serial: string): Promise<DeviceHealth> =>
  invoke<DeviceHealth>("device_health", { serial });
```

- [ ] **Step 3: Create `src/hooks/useResale.ts`**

```ts
import { useState } from "react";
import type { AppInfo, DeviceHealth, FrpStatus, ManageAppsResult } from "../types";
import { checkFrpStatus, deviceHealth, listApps, manageApps } from "../lib/ipc";

export function useResale() {
  const [frpStatus, setFrpStatus] = useState<FrpStatus | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(fn: () => Promise<T>, setter: (v: T) => void) => {
    setLoading(true);
    setError(null);
    try {
      setter(await fn());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const checkFrp = (serial: string) => run(() => checkFrpStatus(serial), setFrpStatus);
  const listAppsAction = (serial: string) => run(() => listApps(serial), setApps);
  const getHealth = (serial: string) => run(() => deviceHealth(serial), setHealth);
  const manage = (serial: string, packages: string[], action: "disable" | "uninstall") =>
    run(() => manageApps(serial, packages, action), () => {});

  return {
    frpStatus,
    apps,
    health,
    loading,
    error,
    checkFrp: checkFrp,
    listApps: listAppsAction,
    manageApps: manage,
    getHealth,
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
git add src/types.ts src/lib/ipc.ts src/hooks/useResale.ts
git commit -m "feat(frontend): add resale ipc wrappers and hook"
```

---

### Task 4: Frontend â€” expand `OperationGrid` with resale buttons

**Files:**
- Modify: `src/components/OperationGrid.tsx` (add Check FRP, Apps, Ficha SaÃºde buttons + Apps modal + health card)

**Interfaces:**
- Consumes: `useResale` (Task 3), existing props.
- Produces: 3 new buttons + Apps modal (checkboxes, Desativar/Remover) + health card + FRP banner.

- [ ] **Step 1: Update `OperationGrid.tsx`**

Add imports:

```tsx
import { useResale } from "../hooks/useResale";
import type { AppInfo, Platform } from "../types";
```

In the component body, add:

```tsx
  const [appsOpen, setAppsOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const {
    frpStatus,
    apps,
    health,
    loading: resaleLoading,
    error: resaleError,
    checkFrp,
    listApps: listAppsAction,
    manageApps: manageAppsAction,
    getHealth,
  } = useResale();

  const toggleApp = (pkg: string) => {
    setSelected((prev) => (prev.includes(pkg) ? prev.filter((p) => p !== pkg) : [...prev, pkg]));
  };

  const openApps = async () => {
    setAppsOpen(true);
    await listAppsAction(serial);
  };

  const handleManage = async (action: "disable" | "uninstall") => {
    if (selected.length === 0) return;
    await manageAppsAction(serial, selected, action);
    await listAppsAction(serial);
    setSelected([]);
  };
```

Add three buttons after the "Format Userdata" button (before the modals):

```tsx
      <button
        onClick={() => checkFrp(serial)}
        disabled={busy}
        className={buttonClass}
      >
        <span className={ACCENT[platform]}>Check FRP</span>
      </button>
      <button onClick={openApps} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>Apps</span>
      </button>
      <button onClick={() => getHealth(serial)} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>Ficha SaÃºde</span>
      </button>
```

Note: `busy` currently only covers `rebooting || formatting`. Since resale actions are read/light-weight, keep them clickable while rebooting/formatting but disabled when `resaleLoading` â€” update `busy` to `rebooting || formatting` as-is and rely on the individual loading states; the buttons are disabled via `disabled={busy}` consistent with existing. (Do NOT include `resaleLoading` in `busy` â€” the resale operations are quick and non-destructive.)

Add the FRP banner (after the error banner):

```tsx
      {frpStatus && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            frpStatus.frp_blocked
              ? "border border-log-warn/40 bg-log-warn/10 text-log-warn"
              : "border border-log-ok/40 bg-log-ok/10 text-log-ok"
          }`}
        >
          {frpStatus.message}
        </div>
      )}
```

Add the health card (after the FRP banner):

```tsx
      {health && (
        <div className="rounded border border-border bg-panel p-3">
          <h4 className="text-sm font-semibold text-fg">Ficha de SaÃºde</h4>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <dt className="text-muted">Modelo</dt>
            <dd className="text-fg">{health.model || "â€”"}</dd>
            <dt className="text-muted">IMEI</dt>
            <dd className="text-fg">{health.imei || "â€”"}</dd>
            <dt className="text-muted">Android</dt>
            <dd className="text-fg">{health.android_version || "â€”"}</dd>
            <dt className="text-muted">Build</dt>
            <dd className="text-fg">{health.build || "â€”"}</dd>
            <dt className="text-muted">Armazenamento total</dt>
            <dd className="text-fg">{health.total_storage || "â€”"}</dd>
            <dt className="text-muted">Livre</dt>
            <dd className="text-fg">{health.free_storage || "â€”"}</dd>
            <dt className="text-muted">Bateria</dt>
            <dd className="text-fg">{health.battery}%</dd>
            <dt className="text-muted">FRP</dt>
            <dd className="text-fg">{health.frp_blocked ? "presente" : "limpo"}</dd>
          </dl>
        </div>
      )}
```

Add the Apps modal (before the closing `</div>` of the grid):

```tsx
      {appsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Apps instalados</h3>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar app..."
              className="mt-2 rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <ul className="mt-3 flex-1 overflow-y-auto">
              {apps
                .filter((a: AppInfo) => a.package.toLowerCase().includes(search.toLowerCase()))
                .map((a: AppInfo) => (
                  <li key={a.package} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={selected.includes(a.package)}
                      onChange={() => toggleApp(a.package)}
                    />
                    <span className="truncate text-xs text-fg">{a.package}</span>
                    {a.system && (
                      <span className="ml-auto rounded bg-border px-1 text-[10px] text-muted">sistema</span>
                    )}
                    {!a.enabled && (
                      <span className="rounded bg-border px-1 text-[10px] text-muted">desativado</span>
                    )}
                  </li>
                ))}
            </ul>
            {resaleError && (
              <div className="mt-2 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
                {resaleError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setAppsOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
              <button
                onClick={() => handleManage("disable")}
                disabled={selected.length === 0}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border disabled:opacity-50"
              >
                Desativar
              </button>
              <button
                onClick={() => handleManage("uninstall")}
                disabled={selected.length === 0}
                className="rounded bg-log-warn px-3 py-1.5 text-sm text-black hover:opacity-80 disabled:opacity-50"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/components/OperationGrid.tsx
git commit -m "feat(frontend): add resale buttons, apps modal and health card"
```

---

### Task 5: End-to-end verification + README

**Files:**
- Modify: `README.md` (document resale prep)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 32 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README (after the "## Grid de OperaÃ§Ãµes (Xiaomi/MTK)" section):

```markdown
## PreparaÃ§Ã£o de Revenda

O grid de operaÃ§Ãµes inclui 3 botÃµes para preparar aparelhos para revenda:

- **Check FRP** â€” verifica se o FRP estÃ¡ limpo (ro.frp.pst) e mostra o status (verde = limpo, Ã¢mbar = presente).
- **Apps** â€” lista os apps instalados (sistema + usuÃ¡rio) e permite desativar (`pm disable-user`) ou remover (`pm uninstall`) os selecionados.
- **Ficha SaÃºde** â€” mostra modelo, IMEI, Android, build, armazenamento, bateria e status FRP.
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document resale prep operations"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: on the Xiaomi/MTK tab with a device, Check FRP shows the banner, Apps opens the list modal and manages selected apps, Ficha SaÃºde shows the card. Skip if no device â€” note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: parsers TDD (Task 1), 4 commands + wiring (Task 2), frontend types/ipc/hook (Task 3), OperationGrid expansion (Task 4), verification (Task 5). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `FrpStatus`/`AppInfo`/`ManageAppsResult`/`DeviceHealth` fields match between `commands.rs` and `types.ts`; command names match `ipc.ts` wrappers (`check_frp_status`â†”`checkFrpStatus`, `list_apps`â†”`listApps`, `manage_apps`â†”`manageApps`, `device_health`â†”`deviceHealth`); parser marker lines (`SYSTEM_APPS`/`USER_APPS`/`DISABLED_APPS`) match between `list_apps` assembly and `parse_apps`.


