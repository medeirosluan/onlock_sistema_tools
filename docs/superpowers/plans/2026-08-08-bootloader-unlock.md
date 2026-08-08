# OnLock Suite — Bootloader Unlock (fastboot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second real operation to OnLock Suite — bootloader unlock via fastboot, in a guided step-by-step flow with mandatory confirmation, pre-check of unlock state, command fallback, and optional reboot/redetect.

**Architecture:** Extend `operations.rs` with `BootloaderUnlocker` (same pattern as `FrpRemover`: pure `bootloader_steps()`/`is_bootloader_unlocked()` + orchestrated `run`). `adb_controller.rs` gains fastboot helpers via a separate `sidecar("fastboot")` resolution. Frontend adds `useBootloader` hook, an unlock button in the Operations section, and typed IPC.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecar), tokio, React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. fastboot binary from the same platform-tools download (no new download). `externalBin` gains `"binaries/fastboot"`. `.gitignore` already covers `src-tauri/binaries/`.
- Commands: `unlock_bootloader(serial: String) -> Result<BootloaderResult, String>`, `fastboot_reboot(serial: String) -> Result<(), String>`.
- `BootloaderResult { serial: String, success: bool, steps_completed: usize, message: String }` (Serialize).
- `bootloader_steps()` returns exactly 5 steps (pt-BR descriptions); `is_bootloader_unlocked(output: &str) -> bool` parses `getvar unlocked` output.
- Steps: verify (getvar unlocked), fastboot mode (adb reboot bootloader), unlock (flashing unlock → fallback oem unlock), confirm, done. Steps 1-4 essential; done counted in steps_completed.
- If already unlocked at step 1: return success without executing unlock.
- UI pt-BR. Mandatory confirmation before running (serial, model, warning "desbloqueia o bootloader e apaga os dados", command list).
- Tests only in Rust: `operations.rs` pure logic (bootloader_steps, bootloader_result, is_bootloader_unlocked). No unit tests for real fastboot calls.
- No comments in code unless required by convention.
- Follow the existing `FrpRemover::run` pattern: loop driven by step metadata (`essential` decides fail-fast vs warn-and-continue), "done" located by id and counted.

---

### Task 1: Sidecar + Backend — fastboot binary and `AdbController` fastboot helpers

**Files:**
- Modify: `scripts/download-adb.ps1` (copy `fastboot.exe`)
- Modify: `src-tauri/tauri.conf.json` (externalBin gains `binaries/fastboot`)
- Modify: `src-tauri/src/adb_controller.rs` (add `reboot_bootloader`, `fastboot`, `fastboot_reboot`, private `run_fastboot`)

**Interfaces:**
- Consumes: existing private `AdbController::run` (adb sidecar).
- Produces:
  - `pub async fn reboot_bootloader(app: &AppHandle, serial: &str) -> Result<(), String>`
  - `pub async fn fastboot(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String>`
  - `pub async fn fastboot_reboot(app: &AppHandle, serial: &str) -> Result<(), String>`

- [ ] **Step 1: Update the download script**

In `scripts/download-adb.ps1`, after the adb.exe copy lines, add:

```powershell
Copy-Item -Force (Join-Path $tmpDir "platform-tools\fastboot.exe") (Join-Path $binDir "fastboot-x86_64-pc-windows-msvc.exe")
```

- [ ] **Step 2: Add fastboot to `externalBin`**

In `src-tauri/tauri.conf.json`, change `bundle.externalBin` to:

```json
"externalBin": [
  "binaries/adb",
  "binaries/fastboot"
]
```

- [ ] **Step 3: Run the download and verify**

```powershell
npm run download:adb
```
Expected: `src-tauri/binaries/fastboot-x86_64-pc-windows-msvc.exe` exists.

- [ ] **Step 4: Add fastboot helpers to `adb_controller.rs`**

Inside `impl AdbController`, after `reboot`, add:

```rust
pub async fn reboot_bootloader(app: &AppHandle, serial: &str) -> Result<(), String> {
    Self::run(app, &["-s", serial, "reboot", "bootloader"]).await?;
    Ok(())
}

pub async fn fastboot(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
    let mut full_args = vec!["-s", serial];
    full_args.extend_from_slice(args);
    Self::run_fastboot(app, &full_args).await
}

pub async fn fastboot_reboot(app: &AppHandle, serial: &str) -> Result<(), String> {
    Self::run_fastboot(app, &["-s", serial, "reboot"]).await?;
    Ok(())
}
```

Add a private `run_fastboot` method next to the existing private `run`:

```rust
async fn run_fastboot(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let command = app
        .shell()
        .sidecar("fastboot")
        .map_err(|e| format!("Erro ao resolver sidecar fastboot: {e}"))?;
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        command.args(args).output(),
    )
    .await
    .map_err(|_| "fastboot não respondeu dentro de 15 segundos".to_string())?
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
```

- [ ] **Step 5: Verify compiles + existing tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 17 tests pass. (The new fastboot helpers are consumed by later tasks — `dead_code` warnings are expected.)

- [ ] **Step 6: Commit**

```powershell
git add scripts/download-adb.ps1 src-tauri/tauri.conf.json src-tauri/src/adb_controller.rs
git commit -m "feat(fastboot): add fastboot sidecar and controller helpers"
```

---

### Task 2: Backend — bootloader unlock logic (TDD)

**Files:**
- Modify: `src-tauri/src/operations.rs` (add `BootloaderResult`, `BootloaderStep`, `bootloader_steps`, `bootloader_result`, `is_bootloader_unlocked`, `BootloaderUnlocker`)

**Interfaces:**
- Consumes: `AdbController::{fastboot, reboot_bootloader, fastboot_reboot}` (Task 1), `commands::emit_log` (existing).
- Produces:
  - `pub struct BootloaderResult { pub serial: String, pub success: bool, pub steps_completed: usize, pub message: String }` (derive `Debug`, `Clone`, `Serialize`)
  - `pub struct BootloaderStep { pub id: &'static str, pub description: &'static str, pub essential: bool }` (derive `Debug`, `Clone`, `PartialEq`)
  - `pub fn bootloader_steps() -> Vec<BootloaderStep>` — 5 steps
  - `pub fn bootloader_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> BootloaderResult`
  - `pub fn is_bootloader_unlocked(output: &str) -> bool`
  - `pub struct BootloaderUnlocker;` with `pub async fn run(app: &AppHandle, serial: &str) -> Result<BootloaderResult, String>`

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Append to `src-tauri/src/operations.rs` (before the `#[cfg(test)]` module):

```rust
#[derive(Debug, Clone, Serialize)]
pub struct BootloaderResult {
    pub serial: String,
    pub success: bool,
    pub steps_completed: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootloaderStep {
    pub id: &'static str,
    pub description: &'static str,
    pub essential: bool,
}

pub fn bootloader_steps() -> Vec<BootloaderStep> {
    Vec::new()
}

pub fn bootloader_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> BootloaderResult {
    BootloaderResult {
        serial: serial.to_string(),
        success,
        steps_completed,
        message: message.to_string(),
    }
}

pub fn is_bootloader_unlocked(output: &str) -> bool {
    false
}

pub struct BootloaderUnlocker;

impl BootloaderUnlocker {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<BootloaderResult, String> {
        let _ = (app, serial);
        Ok(bootloader_result(serial, false, 0, "não implementado"))
    }
}
```

Add tests to the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn bootloader_steps_has_five_ptbr_steps() {
        let steps = bootloader_steps();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0].id, "verify");
        assert_eq!(steps[1].id, "fastboot");
        assert_eq!(steps[2].id, "unlock");
        assert_eq!(steps[3].id, "confirm");
        assert_eq!(steps[4].id, "done");
        for step in &steps {
            assert!(step.essential);
            assert!(!step.description.is_empty());
        }
    }

    #[test]
    fn bootloader_result_assembles_success() {
        let r = bootloader_result("ROJNKFZ57XJFD6N7", true, 5, "Bootloader desbloqueado");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.steps_completed, 5);
        assert_eq!(r.message, "Bootloader desbloqueado");
    }

    #[test]
    fn bootloader_result_assembles_failure() {
        let r = bootloader_result("ROJNKFZ57XJFD6N7", false, 1, "Verificação falhou");
        assert!(!r.success);
        assert_eq!(r.steps_completed, 1);
    }

    #[test]
    fn is_bootloader_unlocked_detects_unlocked() {
        assert!(is_bootloader_unlocked("unlocked: yes\n"));
        assert!(is_bootloader_unlocked("  (bootloader) unlocked: yes"));
        assert!(is_bootloader_unlocked("unlocked:true"));
    }

    #[test]
    fn is_bootloader_unlocked_detects_locked() {
        assert!(!is_bootloader_unlocked("unlocked: no\n"));
        assert!(!is_bootloader_unlocked("  (bootloader) unlocked: no"));
        assert!(!is_bootloader_unlocked(""));
        assert!(!is_bootloader_unlocked("error: cannot get unlocked state"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test operations
```
Expected: FAIL — the bootloader tests fail (empty steps, `is_bootloader_unlocked` always false).

- [ ] **Step 3: Implement `bootloader_steps`**

```rust
pub fn bootloader_steps() -> Vec<BootloaderStep> {
    vec![
        BootloaderStep {
            id: "verify",
            description: "Verificando estado do bootloader",
            essential: true,
        },
        BootloaderStep {
            id: "fastboot",
            description: "Entrando em modo fastboot",
            essential: true,
        },
        BootloaderStep {
            id: "unlock",
            description: "Executando desbloqueio do bootloader",
            essential: true,
        },
        BootloaderStep {
            id: "confirm",
            description: "Confirmando estado desbloqueado",
            essential: true,
        },
        BootloaderStep {
            id: "done",
            description: "Concluindo desbloqueio do bootloader",
            essential: true,
        },
    ]
}
```

- [ ] **Step 4: Implement `is_bootloader_unlocked`**

```rust
pub fn is_bootloader_unlocked(output: &str) -> bool {
    output.lines().any(|line| {
        let line = line.trim().to_lowercase();
        line.contains("unlocked") && (line.contains("yes") || line.contains("true"))
    })
}
```

- [ ] **Step 5: Implement `BootloaderUnlocker::run`**

```rust
impl BootloaderUnlocker {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<BootloaderResult, String> {
        let steps = bootloader_steps();
        let mut completed = 0;

        for step in &steps {
            emit_log(app, "info", &format!("[BOOT] {}", step.description));

            if step.id == "done" {
                emit_log(app, "ok", &format!("[BOOT] {} — reinicie o aparelho.", step.description));
                completed += 1;
                break;
            }

            let result = match step.id {
                "verify" => {
                    let out = AdbController::fastboot(app, serial, &["getvar", "unlocked"]).await;
                    if let Ok(ref out) = out {
                        if is_bootloader_unlocked(out) {
                            emit_log(app, "info", "Bootloader já está desbloqueado.");
                            return Ok(bootloader_result(
                                serial,
                                true,
                                1,
                                "Bootloader já está desbloqueado",
                            ));
                        }
                    }
                    out
                }
                "fastboot" => AdbController::reboot_bootloader(app, serial).await.map(|_| String::new()),
                "unlock" => {
                    match AdbController::fastboot(app, serial, &["flashing", "unlock"]).await {
                        Ok(o) => Ok(o),
                        Err(first_err) => {
                            emit_log(app, "warn", &format!("flashing unlock falhou, tentando oem unlock: {first_err}"));
                            AdbController::fastboot(app, serial, &["oem", "unlock"]).await
                        }
                    }
                }
                "confirm" => {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    let out = AdbController::fastboot(app, serial, &["getvar", "unlocked"]).await;
                    if let Ok(ref out) = out {
                        if is_bootloader_unlocked(out) {
                            emit_log(app, "ok", "Bootloader confirmado como desbloqueado.");
                        }
                    }
                    Ok(String::new())
                }
                _ => continue,
            };

            match result {
                Ok(_) => {
                    completed += 1;
                }
                Err(e) => {
                    emit_log(app, "error", &format!("[BOOT] {} falhou: {e}", step.description));
                    return Err(format!("Falha em '{}' no dispositivo {serial}: {e}", step.id));
                }
            }
        }

        Ok(bootloader_result(serial, true, completed, "Bootloader desbloqueado — reinicie o aparelho"))
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 21 tests (4 new bootloader + 17 existing).

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/operations.rs
git commit -m "feat(ops): add bootloader unlock logic with tests"
```

---

### Task 3: Backend — commands + lib wiring

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `unlock_bootloader`, `fastboot_reboot`)
- Modify: `src-tauri/src/lib.rs` (register both)

**Interfaces:**
- Consumes: `operations::{BootloaderUnlocker, BootloaderResult}` (Task 2), `AdbController::fastboot_reboot` (Task 1).
- Produces:
  - `pub async fn unlock_bootloader(app: AppHandle, serial: String) -> Result<BootloaderResult, String>`
  - `pub async fn fastboot_reboot(app: AppHandle, serial: String) -> Result<(), String>`

- [ ] **Step 1: Add the two commands**

In `src-tauri/src/commands.rs`, add `use crate::operations::{BootloaderResult, BootloaderUnlocker, FrpRemover, FrpResult};`, then append before `clear_logs`:

```rust
#[tauri::command]
pub async fn unlock_bootloader(app: AppHandle, serial: String) -> Result<BootloaderResult, String> {
    emit_log(&app, "info", &format!("Iniciando desbloqueio do bootloader no dispositivo {serial}..."));
    BootloaderUnlocker::run(&app, &serial).await
}

#[tauri::command]
pub async fn fastboot_reboot(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando dispositivo {serial} (fastboot)..."));
    AdbController::fastboot_reboot(&app, &serial).await?;
    emit_log(&app, "ok", &format!("Reinício iniciado em {serial}."));
    Ok(())
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `commands::unlock_bootloader,` and `commands::fastboot_reboot,` to the `invoke_handler` list.

- [ ] **Step 3: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 21 tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri
git commit -m "feat(ops): wire bootloader unlock and fastboot reboot commands"
```

---

### Task 4: Frontend — types, IPC, hook

**Files:**
- Modify: `src/types.ts` (add `BootloaderResult`)
- Modify: `src/lib/ipc.ts` (add `unlockBootloader`, `fastbootReboot`)
- Create: `src/hooks/useBootloader.ts`

**Interfaces:**
- Consumes: backend commands from Task 3.
- Produces:
  - `types.ts`: `interface BootloaderResult { serial: string; success: boolean; steps_completed: number; message: string }`
  - `ipc.ts`: `unlockBootloader(serial: string): Promise<BootloaderResult>`, `fastbootReboot(serial: string): Promise<void>`
  - `useBootloader.ts`: `useBootloader() => { running: boolean, result: BootloaderResult | null, error: string | null, confirming: boolean, setConfirming(v: boolean): void, run(serial: string): Promise<void>, reboot(serial: string): Promise<void> }`

- [ ] **Step 1: Add `BootloaderResult` to `src/types.ts`**

Append to the file:

```ts
export interface BootloaderResult {
  serial: string;
  success: boolean;
  steps_completed: number;
  message: string;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, BootloaderResult, DeviceInfo, FrpResult, LogEntry } from "../types";

export const unlockBootloader = (serial: string): Promise<BootloaderResult> =>
  invoke<BootloaderResult>("unlock_bootloader", { serial });

export const fastbootReboot = (serial: string): Promise<void> =>
  invoke("fastboot_reboot", { serial });
```

- [ ] **Step 3: Create `src/hooks/useBootloader.ts`**

```ts
import { useState } from "react";
import type { BootloaderResult } from "../types";
import { fastbootReboot, unlockBootloader } from "../lib/ipc";

export function useBootloader() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BootloaderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (serial: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await unlockBootloader(serial));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const reboot = async (serial: string) => {
    setError(null);
    try {
      await fastbootReboot(serial);
    } catch (e) {
      setError(String(e));
    }
  };

  return { running, result, error, confirming, setConfirming, run, reboot };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useBootloader.ts
git commit -m "feat(frontend): add bootloader ipc wrappers and hook"
```

---

### Task 5: Frontend — bootloader UI in `DevicePanel`

**Files:**
- Modify: `src/components/DevicePanel.tsx` (add unlock button, confirmation, result, reboot)

**Interfaces:**
- Consumes: `useBootloader` (Task 4), `DeviceInfo` (existing), theme tokens (existing).
- Produces: the bootloader unlock UI in the Operations section.

- [ ] **Step 1: Update `DevicePanel.tsx`**

Add `useBootloader` to the imports:

```tsx
import { useBootloader } from "../hooks/useBootloader";
```

Add a `BOOTLOADER_COMMANDS` constant near `FRP_COMMANDS`:

```tsx
const BOOTLOADER_COMMANDS = [
  "fastboot getvar unlocked",
  "fastboot flashing unlock",
  "fastboot oem unlock",
];
```

In the component body, add:

```tsx
  const [bootConfirmOpen, setBootConfirmOpen] = useState(false);
  const {
    running: bootRunning,
    result: bootResult,
    error: bootError,
    run: bootRun,
    reboot: bootReboot,
  } = useBootloader();
```

In the Operations section, after the FRP block (before the closing `</div>` of the operations card), add the bootloader block. It renders "Desbloquear bootloader" button when not running and no successful result; the running message; the success banner + "Reiniciar aparelho" (calls `bootReboot(device.serial)`); the error banner; and the confirmation modal (guarded by `bootConfirmOpen && device`). Use pt-BR strings, warning text "Esta operação desbloqueia o bootloader e apaga os dados do aparelho.", and the `BOOTLOADER_COMMANDS` list. Confirm calls `setBootConfirmOpen(false); setConfirming(true); bootRun(device.serial);` (mirror the FRP modal's structure exactly, but for bootloader).

Also add the modal JSX (guarded by `bootConfirmOpen && device`) following the same pattern as the existing FRP modal.

- [ ] **Step 2: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/components/DevicePanel.tsx
git commit -m "feat(frontend): add bootloader unlock section"
```

---

### Task 6: End-to-end verification + README

**Files:**
- Modify: `README.md` (document bootloader unlock)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 21 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README (after the "## Operação: Remoção de FRP" section):

```markdown
## Operação: Desbloqueio de Bootloader (fastboot)

Com um aparelho conectado (modo REAL), a seção "Operações" do painel permite desbloquear o bootloader via fastboot:

1. Clique em **Desbloquear bootloader**.
2. Revise o aparelho e os comandos exibidos e clique em **Confirmar**.
3. Acompanhe o progresso no console de logs.
4. Ao final, clique em **Reiniciar aparelho** para aplicar.

Aviso: o desbloqueio apaga os dados do aparelho. Se o bootloader já estiver desbloqueado, o app informa e não executa.

Comandos executados:

- `fastboot getvar unlocked`
- `fastboot flashing unlock` (fallback: `fastboot oem unlock`)
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document bootloader unlock operation"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: the Operations section shows "Desbloquear bootloader"; confirmation flow works; commands log into the console. Skip if no device — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: fastboot sidecar (Task 1), bootloader logic (Task 2), commands + wiring (Task 3), frontend types/ipc/hook (Task 4), bootloader UI (Task 5), verification (Task 6). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `BootloaderResult` fields match between `operations.rs` and `src/types.ts`; `unlock_bootloader`/`fastboot_reboot` match `unlockBootloader`/`fastbootReboot` in `ipc.ts`; `bootloader_steps()` ids (verify/fastboot/unlock/confirm/done) match the loop in `BootloaderUnlocker::run`.
