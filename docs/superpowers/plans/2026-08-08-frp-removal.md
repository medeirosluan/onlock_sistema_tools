# OnLock Suite — Real FRP Removal Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first real unlock operation to OnLock Suite — FRP (Factory Reset Protection) removal via real `adb shell` commands, in a guided step-by-step flow with mandatory confirmation, real-time progress, and optional reboot/verify.

**Architecture:** New pure, testable module `operations.rs` (`FrpRemover`, `FrpResult`, `FrpStep`, `frp_steps()`) that reuses `AdbController` (sidecar) to run real commands. `commands.rs` gains `run_frp_removal(serial)` and `reboot_device(serial)`. Frontend adds `useFrp` hook, an Operations section in `DevicePanel` (confirm → progress → result), and typed IPC.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecar), tokio, React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. Sidecar adb already configured; `AdbController` reused (no new deps, no config/capability changes).
- Commands: `run_frp_removal(serial: String) -> Result<FrpResult, String>`, `reboot_device(serial: String) -> Result<(), String>`.
- `FrpResult { serial: String, success: bool, steps_completed: usize, message: String }` (Serialize).
- `frp_steps()` returns exactly 5 steps with pt-BR descriptions; steps 1-3 essential (failure stops), step 4 best-effort (WARN and continue), step 5 conclusion.
- Steps: verify (getprop ro.secure), provision (settings put global device_provisioned 1), setup (settings put secure user_setup_complete 1), cleanup (pm clear com.google.android.gms), done.
- UI pt-BR. Confirmation is mandatory before running (shows serial, model, warning, command list).
- Tests only in Rust: `operations.rs` pure logic (frp_steps, FrpResult assembly). No unit tests for real adb calls.
- No comments in code unless required by convention.

---

### Task 1: Backend — extend `AdbController` with shell/reboot helpers

**Files:**
- Modify: `src-tauri/src/adb_controller.rs` (add `run_shell`, `reboot`)

**Interfaces:**
- Consumes: existing `AdbController::run` (private).
- Produces:
  - `pub async fn run_shell(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String>`
  - `pub async fn reboot(app: &AppHandle, serial: &str) -> Result<(), String>`

- [ ] **Step 1: Add `run_shell` and `reboot` methods**

In `impl AdbController` (after `imei`), add:

```rust
pub async fn run_shell(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
    let mut full_args = vec!["-s", serial, "shell"];
    full_args.extend_from_slice(args);
    Self::run(app, &full_args).await
}

pub async fn reboot(app: &AppHandle, serial: &str) -> Result<(), String> {
    Self::run(app, &["-s", serial, "reboot"]).await?;
    Ok(())
}
```

- [ ] **Step 2: Verify compiles + existing tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 14 tests pass (9 adb_controller + 3 adb_simulator + 2 parse_imei).

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/adb_controller.rs
git commit -m "feat(adb): add run_shell and reboot helpers"
```

---

### Task 2: Backend — `operations` module with FRP logic (TDD)

**Files:**
- Create: `src-tauri/src/operations.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod operations;`)

**Interfaces:**
- Consumes: `AdbController::{getprop, run_shell}` (Task 1), `commands::emit_log` (existing, `pub`).
- Produces:
  - `pub struct FrpStep { pub id: &'static str, pub description: &'static str, pub essential: bool }` (derive `Debug`, `Clone`, `PartialEq`)
  - `pub fn frp_steps() -> Vec<FrpStep>` — 5 steps.
  - `pub struct FrpResult { pub serial: String, pub success: bool, pub steps_completed: usize, pub message: String }` (derive `Debug`, `Clone`, `Serialize`)
  - `pub fn frp_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> FrpResult`
  - `pub struct FrpRemover;` with `pub async fn run(app: &AppHandle, serial: &str) -> Result<FrpResult, String>`

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Create `src-tauri/src/operations.rs`:

```rust
use serde::Serialize;
use tauri::AppHandle;

use crate::adb_controller::AdbController;
use crate::commands::emit_log;

#[derive(Debug, Clone, Serialize)]
pub struct FrpResult {
    pub serial: String,
    pub success: bool,
    pub steps_completed: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrpStep {
    pub id: &'static str,
    pub description: &'static str,
    pub essential: bool,
}

pub fn frp_steps() -> Vec<FrpStep> {
    Vec::new()
}

pub fn frp_result(serial: &str, success: bool, steps_completed: usize, message: &str) -> FrpResult {
    FrpResult {
        serial: serial.to_string(),
        success,
        steps_completed,
        message: message.to_string(),
    }
}

pub struct FrpRemover;

impl FrpRemover {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<FrpResult, String> {
        let _ = (app, serial);
        Ok(frp_result(serial, false, 0, "não implementado"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frp_steps_has_five_ptbr_steps() {
        let steps = frp_steps();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0].id, "verify");
        assert_eq!(steps[1].id, "provision");
        assert_eq!(steps[2].id, "setup");
        assert_eq!(steps[3].id, "cleanup");
        assert_eq!(steps[4].id, "done");
        assert!(steps[0].essential);
        assert!(steps[1].essential);
        assert!(steps[2].essential);
        assert!(!steps[3].essential);
        assert!(steps[4].essential);
        for step in &steps {
            assert!(!step.description.is_empty());
            assert!(step.description.chars().all(|c| !c.is_ascii_control()));
        }
    }

    #[test]
    fn frp_result_assembles_success() {
        let r = frp_result("ROJNKFZ57XJFD6N7", true, 5, "FRP removido");
        assert_eq!(r.serial, "ROJNKFZ57XJFD6N7");
        assert!(r.success);
        assert_eq!(r.steps_completed, 5);
        assert_eq!(r.message, "FRP removido");
    }

    #[test]
    fn frp_result_assembles_failure() {
        let r = frp_result("ROJNKFZ57XJFD6N7", false, 1, "Verificação falhou");
        assert!(!r.success);
        assert_eq!(r.steps_completed, 1);
        assert_eq!(r.message, "Verificação falhou");
    }
}
```

Add `mod operations;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test operations
```
Expected: FAIL — `frp_steps_has_five_ptbr_steps` fails (empty list).

- [ ] **Step 3: Implement `frp_steps`**

Replace the `frp_steps` stub:

```rust
pub fn frp_steps() -> Vec<FrpStep> {
    vec![
        FrpStep {
            id: "verify",
            description: "Verificando acesso ao dispositivo via ADB",
            essential: true,
        },
        FrpStep {
            id: "provision",
            description: "Provisionando o dispositivo (device_provisioned)",
            essential: true,
        },
        FrpStep {
            id: "setup",
            description: "Marcando setup como concluído (user_setup_complete)",
            essential: true,
        },
        FrpStep {
            id: "cleanup",
            description: "Limpando contas vinculadas ao FRP (GMS)",
            essential: false,
        },
        FrpStep {
            id: "done",
            description: "Concluindo remoção de FRP",
            essential: true,
        },
    ]
}
```

- [ ] **Step 4: Implement `FrpRemover::run`**

Replace the `run` method:

```rust
impl FrpRemover {
    pub async fn run(app: &AppHandle, serial: &str) -> Result<FrpResult, String> {
        let steps = frp_steps();
        let mut completed = 0;

        for step in steps.iter().take(3) {
            emit_log(app, "info", &format!("[FRP] {}", step.description));
            match step.id {
                "verify" => {
                    AdbController::getprop(app, serial, "ro.secure").await.map_err(|e| {
                        emit_log(app, "error", &format!("[FRP] Verificação falhou: {e}"));
                        format!("Falha ao verificar dispositivo {serial}: {e}")
                    })?;
                }
                "provision" => {
                    AdbController::run_shell(
                        app,
                        serial,
                        &["settings", "put", "global", "device_provisioned", "1"],
                    )
                    .await
                    .map_err(|e| {
                        emit_log(app, "error", &format!("[FRP] Provisionamento falhou: {e}"));
                        format!("Falha ao provisionar dispositivo {serial}: {e}")
                    })?;
                }
                "setup" => {
                    AdbController::run_shell(
                        app,
                        serial,
                        &["settings", "put", "secure", "user_setup_complete", "1"],
                    )
                    .await
                    .map_err(|e| {
                        emit_log(app, "error", &format!("[FRP] Setup falhou: {e}"));
                        format!("Falha ao marcar setup do dispositivo {serial}: {e}")
                    })?;
                }
                _ => {}
            }
            completed += 1;
        }

        let cleanup = &steps[3];
        emit_log(app, "info", &format!("[FRP] {}", cleanup.description));
        match AdbController::run_shell(app, serial, &["pm", "clear", "com.google.android.gms"]).await {
            Ok(_) => {
                completed += 1;
                emit_log(app, "ok", "[FRP] Contas limpas.");
            }
            Err(e) => {
                emit_log(app, "warn", &format!("[FRP] Limpeza de contas não disponível: {e}"));
            }
        }

        let done = &steps[4];
        emit_log(app, "ok", &format!("[FRP] {} — reinicie o aparelho.", done.description));

        Ok(frp_result(serial, true, completed, "FRP removido — reinicie o aparelho"))
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 17 tests (3 new operations + 14 existing).

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/operations.rs src-tauri/src/lib.rs
git commit -m "feat(ops): add frp removal logic with step tests"
```

---

### Task 3: Backend — commands + lib wiring

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `run_frp_removal`, `reboot_device`)
- Modify: `src-tauri/src/lib.rs` (register both commands)

**Interfaces:**
- Consumes: `operations::{FrpRemover, FrpResult}` (Task 2), `AdbController::reboot` (Task 1).
- Produces:
  - `pub async fn run_frp_removal(app: AppHandle, serial: String) -> Result<FrpResult, String>`
  - `pub async fn reboot_device(app: AppHandle, serial: String) -> Result<(), String>`

- [ ] **Step 1: Add the two commands**

In `src-tauri/src/commands.rs`, add `use crate::operations::{FrpRemover, FrpResult};` to the imports, then append before `clear_logs`:

```rust
#[tauri::command]
pub async fn run_frp_removal(app: AppHandle, serial: String) -> Result<FrpResult, String> {
    emit_log(&app, "info", &format!("Iniciando remoção de FRP no dispositivo {serial}..."));
    FrpRemover::run(&app, &serial).await
}

#[tauri::command]
pub async fn reboot_device(app: AppHandle, serial: String) -> Result<(), String> {
    emit_log(&app, "info", &format!("Reiniciando dispositivo {serial}..."));
    AdbController::reboot(&app, &serial).await?;
    emit_log(&app, "ok", &format!("Reinício iniciado em {serial}."));
    Ok(())
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `commands::run_frp_removal,` and `commands::reboot_device,` to the `invoke_handler` list.

- [ ] **Step 3: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 17 tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri
git commit -m "feat(ops): wire frp removal and reboot commands"
```

---

### Task 4: Frontend — types, IPC, hook

**Files:**
- Modify: `src/types.ts` (add `FrpResult`)
- Modify: `src/lib/ipc.ts` (add `runFrpRemoval`, `rebootDevice`)
- Create: `src/hooks/useFrp.ts`

**Interfaces:**
- Consumes: backend commands from Task 3.
- Produces:
  - `types.ts`: `interface FrpResult { serial: string; success: boolean; steps_completed: number; message: string }`
  - `ipc.ts`: `runFrpRemoval(serial: string): Promise<FrpResult>`, `rebootDevice(serial: string): Promise<void>`
  - `useFrp.ts`: `useFrp() => { running: boolean, result: FrpResult | null, error: string | null, confirming: boolean, setConfirming(v: boolean): void, run(serial: string): Promise<void>, reboot(serial: string): Promise<void> }`

- [ ] **Step 1: Add `FrpResult` to `src/types.ts`**

Append to the file:

```ts
export interface FrpResult {
  serial: string;
  success: boolean;
  steps_completed: number;
  message: string;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, DeviceInfo, FrpResult, LogEntry } from "../types";

export const runFrpRemoval = (serial: string): Promise<FrpResult> =>
  invoke<FrpResult>("run_frp_removal", { serial });

export const rebootDevice = (serial: string): Promise<void> =>
  invoke("reboot_device", { serial });
```

- [ ] **Step 3: Create `src/hooks/useFrp.ts`**

```ts
import { useState } from "react";
import type { FrpResult } from "../types";
import { rebootDevice, runFrpRemoval } from "../lib/ipc";

export function useFrp() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FrpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (serial: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runFrpRemoval(serial));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const reboot = async (serial: string) => {
    setError(null);
    try {
      await rebootDevice(serial);
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
git add src/types.ts src/lib/ipc.ts src/hooks/useFrp.ts
git commit -m "feat(frontend): add frp ipc wrappers and hook"
```

---

### Task 5: Frontend — Operations section in `DevicePanel`

**Files:**
- Modify: `src/components/DevicePanel.tsx` (add Operations section: button, confirmation modal, progress, result, reboot)

**Interfaces:**
- Consumes: `useFrp` (Task 4), `DeviceInfo` (existing), theme tokens (existing).
- Produces: the Operations UI — button "Remover FRP" (visible when `device?.connected`), mandatory confirmation, live progress list, result banner, "Reiniciar aparelho" button on success.

- [ ] **Step 1: Update `DevicePanel.tsx`**

Replace the entire file with:

```tsx
import { useState } from "react";
import { useFrp } from "../hooks/useFrp";
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

const FRP_COMMANDS = [
  "settings put global device_provisioned 1",
  "settings put secure user_setup_complete 1",
  "pm clear com.google.android.gms",
];

export function DevicePanel({ platform, device, loading, error, mode, onDetect }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { running, result, error: frpError, setConfirming, run, reboot } = useFrp();

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

  const handleConfirm = () => {
    setConfirmOpen(false);
    setConfirming(true);
    run(device!.serial);
  };

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

      {device?.connected && (
        <div className="rounded border border-border bg-panel p-4">
          <h3 className="text-sm font-semibold text-fg">Operações</h3>
          <p className="mt-1 text-xs text-muted">
            Remova o bloqueio de conta (FRP) do aparelho conectado.
          </p>

          {frpError && (
            <div className="mt-3 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
              {frpError}
            </div>
          )}

          {result?.success ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-log-ok">FRP removido — reinicie o aparelho.</p>
              <button
                onClick={() => reboot(device.serial)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Reiniciar aparelho
              </button>
            </div>
          ) : (
            !running && (
              <button
                onClick={() => setConfirmOpen(true)}
                className="mt-3 rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border"
              >
                Remover FRP
              </button>
            )
          )}

          {running && (
            <p className="mt-3 text-sm text-muted">Executando remoção de FRP... Acompanhe o console de logs.</p>
          )}
        </div>
      )}

      {confirmOpen && device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar remoção de FRP</h3>
            <p className="mt-2 text-xs text-muted">
              Dispositivo: <span className="font-mono text-fg">{device.serial}</span>
              {device.model ? ` (${device.model})` : ""}
            </p>
            <p className="mt-2 text-sm text-log-warn">
              Esta operação remove o bloqueio de conta (FRP) do aparelho.
            </p>
            <p className="mt-2 text-xs text-muted">Comandos a executar:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {FRP_COMMANDS.map((cmd) => (
                <li key={cmd} className="font-mono text-xs text-fg">
                  $ {cmd}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
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
git add src/components/DevicePanel.tsx
git commit -m "feat(frontend): add frp operations section with confirmation"
```

---

### Task 6: End-to-end verification + README

**Files:**
- Modify: `README.md` (document FRP operation)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 17 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README (after the "## ADB real (sidecar)" section):

```markdown
## Operação: Remoção de FRP

Com um aparelho conectado (modo REAL), a seção "Operações" do painel permite remover o bloqueio de conta (FRP):

1. Clique em **Remover FRP**.
2. Revise o aparelho e os comandos exibidos e clique em **Confirmar**.
3. Acompanhe o progresso no console de logs.
4. Ao final, clique em **Reiniciar aparelho** para aplicar.

Comandos executados:

- `settings put global device_provisioned 1`
- `settings put secure user_setup_complete 1`
- `pm clear com.google.android.gms`
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document frp removal operation"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: with the Xiaomi connected, the Operations section appears; confirm flow works; commands log into the console; success banner + "Reiniciar aparelho" appear. Skip if no device — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: operations module (Task 2), commands + wiring (Task 3), frontend types/ipc/hook (Task 4), Operations UI with confirmation/progress/reboot (Task 5), verification (Task 6). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `FrpResult` fields match between `operations.rs` and `src/types.ts`; `run_frp_removal`/`reboot_device` match `runFrpRemoval`/`rebootDevice` in `ipc.ts`; `frp_steps()` ids (verify/provision/setup/cleanup/done) match the step loop in `FrpRemover::run`.
