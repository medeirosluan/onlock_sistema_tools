# OnLock Suite — Operation Grid Xiaomi/MTK + Format Userdata + USB Listener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-button operation grid (Read Info, Erase FRP, Reboot Fastboot, Format Userdata) visible on the Xiaomi/MTK tabs, implement the new `format_userdata` command via fastboot, and add a 3s USB polling listener so the top status updates automatically.

**Architecture:** Extend existing modules. `commands.rs` gains `format_userdata` + a `reboot_bootloader` Tauri command (reusing `AdbController` helpers `wait_for_fastboot_device`/`fastboot_long`/`fastboot_reboot`). Frontend gains `OperationGrid.tsx` (4 buttons, per-fabricant accent), a 3s polling interval in `useDevices`, and new IPC wrappers. Reuses existing detect/FRP/logs.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecar), React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. Reuse existing adb/fastboot sidecars and `AdbController` helpers. No new deps, no capability changes.
- New commands: `format_userdata(serial: String) -> Result<FormatResult, String>`, `reboot_bootloader_cmd(serial: String) -> Result<(), String>`.
- `FormatResult { serial: String, success: bool, message: String }` (Serialize). Pure helper `format_result(serial, success, message)`.
- Format sequence: `adb reboot bootloader` → `wait_for_fastboot_device(30s)` → `fastboot_long erase userdata` (60s) → `fastboot_reboot`. Logs INFO/OK/ERROR per step.
- Grid of 4 buttons shown on Xiaomi and MTK tabs only. Accent per fabricant (xiaomi=laranja, mtk=roxo). Destructive ops (Format Userdata) require confirmation; Reboot Fastboot light confirmation.
- USB listener = 3s `setInterval(refresh)` in `useDevices`, with cleanup and loading guard.
- UI pt-BR. Tests only in Rust (format_result). No unit tests for real fastboot.
- No comments in code unless required by convention.

---

### Task 1: Backend — `format_userdata` + `reboot_bootloader_cmd` commands (TDD for format_result)

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `FormatResult`, `format_result`, `format_userdata`, `reboot_bootloader_cmd`)
- Modify: `src-tauri/src/lib.rs` (register both)

**Interfaces:**
- Consumes: `AdbController::{reboot_bootloader, wait_for_fastboot_device, fastboot_long, fastboot_reboot}` (existing).
- Produces:
  - `pub struct FormatResult { pub serial: String, pub success: bool, pub message: String }` (derive `Debug`, `Clone`, `Serialize`)
  - `pub fn format_result(serial: &str, success: bool, message: &str) -> FormatResult`
  - `pub async fn format_userdata(app: AppHandle, serial: String) -> Result<FormatResult, String>`
  - `pub async fn reboot_bootloader_cmd(app: AppHandle, serial: String) -> Result<(), String>`

- [ ] **Step 1: Add `FormatResult` + `format_result` to `commands.rs`**

Add near the top of `src-tauri/src/commands.rs` (after `AdbStatusPayload`):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct FormatResult {
    pub serial: String,
    pub success: bool,
    pub message: String,
}

fn format_result(serial: &str, success: bool, message: &str) -> FormatResult {
    FormatResult {
        serial: serial.to_string(),
        success,
        message: message.to_string(),
    }
}
```

- [ ] **Step 2: Add `format_userdata` + `reboot_bootloader_cmd` commands**

Append before `clear_logs` in `commands.rs`:

```rust
#[tauri::command]
pub async fn reboot_bootloader_cmd(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando {serial} em modo fastboot..."));
    AdbController::reboot_bootloader(&app, &serial).await?;
    emit_log(&app, "ok", &format!("{serial} reiniciado em fastboot."));
    Ok(())
}

#[tauri::command]
pub async fn format_userdata(app: AppHandle, serial: String) -> Result<FormatResult, String> {
    emit_log(&app, "info", &format!("Iniciando formatação do userdata em {serial}..."));

    AdbController::reboot_bootloader(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao reiniciar em fastboot: {e}"));
        format!("Falha ao reiniciar {serial} em fastboot: {e}")
    })?;
    emit_log(&app, "ok", "Aparelho reiniciado em modo fastboot.");

    AdbController::wait_for_fastboot_device(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("{e}"));
        e
    })?;
    emit_log(&app, "ok", "Aparelho detectado em modo fastboot.");

    AdbController::fastboot_long(&app, &serial, &["erase", "userdata"]).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao apagar userdata: {e}"));
        format!("Falha ao apagar userdata em {serial}: {e}")
    })?;
    emit_log(&app, "ok", "Partição userdata apagada.");

    AdbController::fastboot_reboot(&app, &serial).await.map_err(|e| {
        emit_log(&app, "error", &format!("Falha ao reiniciar: {e}"));
        format!("Falha ao reiniciar {serial}: {e}")
    })?;
    emit_log(&app, "ok", &format!("{serial} reiniciado após formatação."));

    Ok(format_result(&serial, true, "Userdata formatado com sucesso"))
}
```

- [ ] **Step 3: Register in `lib.rs`**

Add `commands::format_userdata,` and `commands::reboot_bootloader_cmd,` to the `invoke_handler` list.

- [ ] **Step 4: Write the `format_result` test**

In `src-tauri/src/commands.rs`, add a `#[cfg(test)] mod tests` block at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_result_assembles_success() {
        let r = format_result("ROJNKFZ57XJFD6N7", true, "Userdata formatado com sucesso");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.message, "Userdata formatado com sucesso");
    }

    #[test]
    fn format_result_assembles_failure() {
        let r = format_result("ROJNKFZ57XJFD6N7", false, "Falha ao apagar userdata");
        assert!(!r.success);
        assert_eq!(r.message, "Falha ao apagar userdata");
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 27 tests (2 new + 25 existing).

- [ ] **Step 6: Commit**

```powershell
git add src-tauri
git commit -m "feat(ops): add format userdata and reboot bootloader commands"
```

---

### Task 2: Frontend — types, IPC wrappers, USB polling

**Files:**
- Modify: `src/types.ts` (add `FormatResult`)
- Modify: `src/lib/ipc.ts` (add `formatUserdata`, `rebootBootloader`)
- Modify: `src/hooks/useDevices.ts` (add 3s polling)

**Interfaces:**
- Consumes: backend commands from Task 1.
- Produces:
  - `types.ts`: `interface FormatResult { serial: string; success: boolean; message: string }`
  - `ipc.ts`: `formatUserdata(serial: string): Promise<FormatResult>` → invoke "format_userdata" {serial}; `rebootBootloader(serial: string): Promise<void>` → invoke "reboot_bootloader_cmd" {serial}
  - `useDevices.ts`: polls every 3s

- [ ] **Step 1: Add `FormatResult` to `src/types.ts`**

Append to the file:

```ts
export interface FormatResult {
  serial: string;
  success: boolean;
  message: string;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, BackupCategory, BackupProgress, BackupResult, BootloaderResult, DeviceInfo, FormatResult, FrpResult, LogEntry } from "../types";

export const formatUserdata = (serial: string): Promise<FormatResult> =>
  invoke<FormatResult>("format_userdata", { serial });

export const rebootBootloader = (serial: string): Promise<void> =>
  invoke("reboot_bootloader_cmd", { serial });
```

- [ ] **Step 3: Add 3s polling to `src/hooks/useDevices.ts`**

Replace the file with:

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
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { devices, loading, error, refresh };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useDevices.ts
git commit -m "feat(frontend): add format ipc wrappers and usb polling"
```

---

### Task 3: Frontend — `OperationGrid` component

**Files:**
- Create: `src/components/OperationGrid.tsx`

**Interfaces:**
- Consumes: `DeviceInfo` (existing), `formatUserdata`, `rebootBootloader` (Task 2), `Platform` (existing).
- Produces: a 4-button grid component with per-fabricant accent.

- [ ] **Step 1: Create `src/components/OperationGrid.tsx`**

```tsx
import { useState } from "react";
import { formatUserdata, rebootBootloader } from "../lib/ipc";
import type { Platform } from "../types";

interface Props {
  platform: Platform;
  serial: string;
  onReadInfo: () => void;
  onEraseFrp: () => void;
}

const ACCENT: Record<Platform, string> = {
  samsung: "text-accent-samsung",
  xiaomi: "text-accent-xiaomi",
  qualcomm: "text-accent-qualcomm",
  mtk: "text-accent-mtk",
};

export function OperationGrid({ platform, serial, onReadInfo, onEraseFrp }: Props) {
  const [rebootOpen, setRebootOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [formatting, setFormatting] = useState(false);

  const handleReboot = async () => {
    setRebootOpen(false);
    setRebooting(true);
    try {
      await rebootBootloader(serial);
    } catch {
      // Erro já registrado pelo backend via log.
    } finally {
      setRebooting(false);
    }
  };

  const handleFormat = async () => {
    setFormatOpen(false);
    setFormatting(true);
    try {
      await formatUserdata(serial);
    } catch {
      // Erro já registrado pelo backend via log.
    } finally {
      setFormatting(false);
    }
  };

  const button =
    "flex flex-col items-center justify-center gap-1 rounded border border-border bg-panel p-4 text-sm hover:bg-border disabled:opacity-50";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button onClick={onReadInfo} className={button}>
        <span className={ACCENT[platform]}>Read Info</span>
      </button>
      <button onClick={onEraseFrp} className={button}>
        <span className={ACCENT[platform]}>Erase FRP</span>
      </button>
      <button onClick={() => setRebootOpen(true)} disabled={rebooting} className={button}>
        <span className={ACCENT[platform]}>{rebooting ? "Reiniciando..." : "Reboot Fastboot"}</span>
      </button>
      <button onClick={() => setFormatOpen(true)} disabled={formatting} className={button}>
        <span className={ACCENT[platform]}>{formatting ? "Formatando..." : "Format Userdata"}</span>
      </button>

      {rebootOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar reinício em fastboot</h3>
            <p className="mt-2 text-sm text-muted">
              Dispositivo: <span className="font-mono text-fg">{serial}</span>
            </p>
            <p className="mt-2 text-xs text-muted">
              O aparelho será reiniciado em modo fastboot (bootloader).
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRebootOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleReboot}
                className="rounded bg-accent-samsung px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {formatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar formatação do userdata</h3>
            <p className="mt-2 text-sm text-muted">
              Dispositivo: <span className="font-mono text-fg">{serial}</span>
            </p>
            <p className="mt-2 text-sm text-log-warn">
              Esta operação apaga todos os dados do usuário do aparelho.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFormatOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleFormat}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/components/OperationGrid.tsx
git commit -m "feat(frontend): add operation grid with per-fabricant actions"
```

---

### Task 4: Frontend — render `OperationGrid` in `DevicePanel` on Xiaomi/MTK tabs

**Files:**
- Modify: `src/components/DevicePanel.tsx` (import + render OperationGrid)

**Interfaces:**
- Consumes: `OperationGrid` (Task 3), `detectDevice` (existing), `useFrp` (existing).
- Produces: the grid rendered on xiaomi/mtk tabs; Read Info calls `onDetect`, Erase FRP opens the existing FRP confirm modal.

- [ ] **Step 1: Update `DevicePanel.tsx`**

Add the import:

```tsx
import { OperationGrid } from "./OperationGrid";
```

In the component body, add a handler for Erase FRP (opens the existing FRP confirmation):

```tsx
  const handleEraseFrp = () => {
    setConfirmOpen(true);
  };
```

Inside the `return`, after the header row (the "Detectar dispositivo" button row) and before the error banner, add the grid when the platform is xiaomi or mtk and a device is connected:

```tsx
      {(platform === "xiaomi" || platform === "mtk") && device?.connected && (
        <OperationGrid
          platform={platform}
          serial={device.serial}
          onReadInfo={onDetect}
          onEraseFrp={handleEraseFrp}
        />
      )}
```

- [ ] **Step 2: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/components/DevicePanel.tsx
git commit -m "feat(frontend): render operation grid on xiaomi and mtk tabs"
```

---

### Task 5: End-to-end verification + README

**Files:**
- Modify: `README.md` (document the grid)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 27 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README (after the "## Operação: Backup / Restauração de Dados" section):

```markdown
## Grid de Operações (Xiaomi/MTK)

Nas abas **Xiaomi** e **MTK**, a área central exibe um grid com 4 botões:

- **Read Info** — lê as informações do aparelho (via `detect_device`).
- **Erase FRP** — executa a remoção de FRP (confirmação obrigatória).
- **Reboot Fastboot** — reinicia o aparelho em modo fastboot.
- **Format Userdata** — apaga a partição userdata via fastboot (apaga os dados; confirmação obrigatória).

O status do topo (dispositivos conectados) é atualizado automaticamente a cada 3 segundos (polling USB).
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document operation grid and usb polling"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: on the Xiaomi tab with a device connected, the 4-button grid appears; Read Info re-detects, Erase FRP opens confirmation, Reboot Fastboot restarts into fastboot, Format Userdata opens the destructive confirmation. The top status updates automatically within ~3s of plugging/unplugging. Skip if no device — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: format_userdata + reboot command (Task 1), types/ipc/polling (Task 2), OperationGrid (Task 3), DevicePanel render (Task 4), verification (Task 5). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `FormatResult` fields match between `commands.rs` and `types.ts`; `format_userdata`/`reboot_bootloader_cmd` match `formatUserdata`/`rebootBootloader` in `ipc.ts`; `OperationGrid` props match its usage in DevicePanel.
