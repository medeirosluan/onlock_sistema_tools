# OnLock Suite — Flash de Firmware com Download Automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add firmware flashing via fastboot with automatic download — the technician identifies the device (model pre-filled by the app), provides the ROM URL, and the app downloads, extracts (if ZIP), detects partitions, flashes via fastboot with progress, double confirmation, and reboot.

**Architecture:** New testable module `flashing.rs` (`FlashResult`, `FlashProgress`, `detect_partition_from_filename`, `flash_from_url`) reusing `AdbController::fastboot`/sidecar. `adb_controller.rs` gains `fastboot_flash` (300s). `commands.rs` gains `flash_firmware`. Frontend adds `useFlash` hook, a Flash Firmware button in the Fastboot panel, a modal with pre-filled model, URL field, double confirmation, progress, and reboot.

**Tech Stack:** Tauri 2.x, Rust, reqwest 0.12 (rustls), zip 2, tokio, tauri-plugin-shell (existing sidecar), React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. Reuse existing adb/fastboot sidecars and `AdbController`.
- New deps: `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }`, `zip = "2"`. `tokio` needs the `fs` feature added (for file I/O in download/extract) — add `"fs"` to the existing tokio features.
- New command: `flash_firmware(app, serial, url, partition: Option<String>) -> Result<FlashResult, String>`.
- `FlashResult { serial, partition, file, success, message }` (Serialize). `FlashProgress { phase, message, percent }` (Serialize), event `flash-progress`.
- `detect_partition_from_filename(filename) -> Option<String>` (pure, tested): boot/recovery/vbmeta/system/etc from filename.
- `adb_controller.rs`: `fastboot_flash(app, serial, partition, local_path)` — `fastboot -s serial flash <partition> <path>`, timeout 300s.
- Flash flow: download to `temp/flash_<serial>/` → extract ZIP if needed → flash each partition → stop on first failure → cleanup temp.
- Fastboot panel button "Flash Firmware" + modal (pre-filled model, URL, optional partition, double confirmation, progress, reboot).
- No cancellation this phase. UI pt-BR. Tests only in Rust. No comments unless required.

---

### Task 1: Backend — deps + `detect_partition_from_filename` + `FlashResult` (TDD)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add reqwest, zip, tokio fs)
- Create: `src-tauri/src/flashing.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod flashing;`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct FlashResult { pub serial: String, pub partition: String, pub file: String, pub success: bool, pub message: String }` (Debug, Clone, Serialize)
  - `pub struct FlashProgress { pub phase: String, pub message: String, pub percent: u8 }` (Debug, Clone, Serialize)
  - `pub fn detect_partition_from_filename(filename: &str) -> Option<String>`
  - `pub fn flash_result(serial: &str, partition: &str, file: &str, success: bool, message: &str) -> FlashResult`

- [ ] **Step 1: Add dependencies to `Cargo.toml`**

In `[dependencies]`:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
zip = "2"
```
And change the tokio line to add `fs`:
```toml
tokio = { version = "1", features = ["time", "fs"] }
```

- [ ] **Step 2: Write the failing tests + minimal skeleton**

Create `src-tauri/src/flashing.rs`:

```rust
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

pub fn detect_partition_from_filename(_filename: &str) -> Option<String> {
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
```

Add `mod flashing;` to `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test flashing
```
Expected: FAIL — `detect_partition_from_filename` returns None. (cargo will also fetch reqwest/zip.)

- [ ] **Step 4: Implement `detect_partition_from_filename`**

```rust
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
```

This handles `boot.img`, `boot_a.img`, `recovery.img` (with or without extension), and rejects `random.txt`, `scatter.txt`, `bootloader-info` (no match).

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 42 tests (3 new + 39 existing).

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/flashing.rs src-tauri/src/lib.rs
git commit -m "feat(flash): add flashing module with partition detection"
```

---

### Task 2: Backend — `fastboot_flash` helper + `flash_from_url` + `flash_firmware` command

**Files:**
- Modify: `src-tauri/src/adb_controller.rs` (add `fastboot_flash`)
- Modify: `src-tauri/src/flashing.rs` (implement `flash_from_url`, `emit_progress`)
- Modify: `src-tauri/src/commands.rs` (add `flash_firmware`)
- Modify: `src-tauri/src/lib.rs` (register)

**Interfaces:**
- Consumes: `FlashResult`/`FlashProgress` (Task 1), `AdbController::{fastboot_flash, fastboot_reboot, fastboot}` (existing/this task), `commands::emit_log` (existing pub).
- Produces:
  - `AdbController::fastboot_flash(app, serial, partition, local_path) -> Result<(), String>` (300s)
  - `flashing::flash_from_url(app, serial, url, partition: Option<String>) -> Result<FlashResult, String>`
  - `commands::flash_firmware(app, serial, url, partition: Option<String>) -> Result<FlashResult, String>`

- [ ] **Step 1: Add `fastboot_flash` to `adb_controller.rs`**

Add after `fastboot_reboot`:

```rust
pub async fn fastboot_flash(app: &AppHandle, serial: &str, partition: &str, local_path: &str) -> Result<(), String> {
    Self::run_fastboot_timeout(
        app,
        &["-s", serial, "flash", partition, local_path],
        Duration::from_secs(300),
    )
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Implement `flash_from_url` in `flashing.rs`**

Replace the file's public API with the full implementation. First add imports and the `emit_progress` helper:

```rust
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use crate::adb_controller::AdbController;
use crate::commands::emit_log;
```

Then add the `emit_progress` private fn:

```rust
fn emit_progress(app: &AppHandle, phase: &str, message: &str, percent: u8) {
    let _ = app.emit(
        "flash-progress",
        FlashProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}
```

Add `flash_from_url`:

```rust
pub async fn flash_from_url(
    app: &AppHandle,
    serial: &str,
    url: &str,
    partition: Option<String>,
) -> Result<FlashResult, String> {
    let dir = std::env::temp_dir().join(format!("flash_{serial}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Falha ao criar pasta temporária: {e}"))?;
    let file_name = url.rsplit('/').next().unwrap_or("firmware.bin").to_string();
    let download_path = dir.join(&file_name);
    let is_zip = file_name.to_lowercase().ends_with(".zip");

    emit_progress(app, "baixando", &format!("Baixando {file_name}..."), 5);
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar {url}: {e}"))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {e}"))?;
    std::fs::write(&download_path, &bytes)
        .map_err(|e| format!("Falha ao salvar {file_name}: {e}"))?;

    emit_log(app, "ok", &format!("Download concluído: {file_name} ({} bytes)", bytes.len()));

    let mut parts: Vec<(String, PathBuf)> = Vec::new();
    if is_zip {
        emit_progress(app, "extraindo", "Extraindo ZIP...", 30);
        let extract_dir = dir.join("extracted");
        std::fs::create_dir_all(&extract_dir).map_err(|e| format!("Falha ao criar pasta de extração: {e}"))?;
        let file = std::fs::File::open(&download_path)
            .map_err(|e| format!("Falha ao abrir ZIP: {e}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("ZIP inválido: {e}"))?;
        archive
            .extract(&extract_dir)
            .map_err(|e| format!("Falha ao extrair ZIP: {e}"))?;
        emit_log(app, "ok", "ZIP extraído.");

        let wanted = partition.clone().map(|p| format!("{p}.img"));
        let mut found = Vec::new();
        collect_img_files(&extract_dir, &extract_dir, &mut found);
        for f in found {
            let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
            if let Some(part) = detect_partition_from_filename(&stem) {
                if wanted.is_none() || wanted.as_deref() == Some(&format!("{part}.img")) {
                    parts.push((part, f.clone()));
                }
            }
        }
    } else {
        let part = partition
            .clone()
            .or_else(|| detect_partition_from_filename(&file_name))
            .ok_or_else(|| "Partição não identificada. Informe a partição de destino.".to_string())?;
        parts.push((part, download_path.clone()));
    }

    if parts.is_empty() {
        return Err("Nenhuma partição detectada no arquivo.".to_string());
    }

    emit_log(app, "info", &format!("Partições a flashar: {:?}", parts.iter().map(|p| p.0.clone()).collect::<Vec<_>>()));

    let mut last_partition = String::new();
    for (part, path) in &parts {
        emit_progress(app, "flashando", &format!("Flashando {part}..."), 60);
        emit_log(app, "info", &format!("Flashando partição {part} de {}...", path.display()));
        match AdbController::fastboot_flash(app, serial, part, &path.to_string_lossy()).await {
            Ok(()) => {
                emit_log(app, "ok", &format!("Partição {part} flashada."));
                last_partition = part.clone();
            }
            Err(e) => {
                emit_log(app, "error", &format!("Falha ao flashar {part}: {e}"));
                let _ = std::fs::remove_dir_all(&dir);
                return Ok(flash_result(serial, part, &path.to_string_lossy(), false, &format!("Falha ao flashar {part}: {e}")));
            }
        }
    }

    emit_progress(app, "concluído", "Flash concluído", 100);
    let _ = std::fs::remove_dir_all(&dir);
    Ok(flash_result(serial, &last_partition, &file_name, true, "Flash concluído com sucesso"))
}

fn collect_img_files(base: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_img_files(base, &path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("img") {
                out.push(path);
            }
        }
    }
}
```

Note: `detect_partition_from_filename` is called with the file stem (no extension). Ensure the implementation in Task 1 works with `boot`/`boot_a` etc. as stems.

- [ ] **Step 3: Add `flash_firmware` command to `commands.rs`**

Add `use crate::flashing::{flash_from_url, FlashResult};` to imports, then append:

```rust
#[tauri::command]
pub async fn flash_firmware(
    app: AppHandle,
    serial: String,
    url: String,
    partition: Option<String>,
) -> Result<FlashResult, String> {
    emit_log(&app, "info", &format!("Iniciando flash de {serial} a partir de {url}..."));
    flash_from_url(&app, &serial, &url, partition).await
}
```

- [ ] **Step 4: Register in `lib.rs`**

Add `commands::flash_firmware,` to the `invoke_handler` list.

- [ ] **Step 5: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 42 tests pass. (reqwest/zip compile — first build fetches crates, allow generous timeout.)

- [ ] **Step 6: Commit**

```powershell
git add src-tauri
git commit -m "feat(flash): add flash from url command with download and extract"
```

---

### Task 3: Frontend — types, IPC wrappers, `useFlash` hook

**Files:**
- Modify: `src/types.ts` (add `FlashProgress`, `FlashResult`)
- Modify: `src/lib/ipc.ts` (add `flashFirmware`, `onFlashProgress`)
- Create: `src/hooks/useFlash.ts`

**Interfaces:**
- Consumes: backend command/event from Task 2.
- Produces:
  - `types.ts`: `FlashProgress`, `FlashResult`.
  - `ipc.ts`: `flashFirmware(serial, url, partition?)`, `onFlashProgress(cb)`.
  - `useFlash.ts`: `{ running, progress, result, error, run }`.

- [ ] **Step 1: Add types to `src/types.ts`**

Append:

```ts
export interface FlashProgress {
  phase: string;
  message: string;
  percent: number;
}

export interface FlashResult {
  serial: string;
  partition: string;
  file: string;
  success: boolean;
  message: string;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, AppInfo, BackupCategory, BackupProgress, BackupResult, BootloaderResult, ConnectionInfo, DeviceInfo, FlashProgress, FlashResult, FormatResult, FrpResult, FrpStatus, LogEntry, ManageAppsResult } from "../types";

export const flashFirmware = (
  serial: string,
  url: string,
  partition?: string,
): Promise<FlashResult> => invoke<FlashResult>("flash_firmware", { serial, url, partition });

export const onFlashProgress = (cb: (p: FlashProgress) => void): Promise<() => void> =>
  listen<FlashProgress>("flash-progress", (event) => cb(event.payload));
```

- [ ] **Step 3: Create `src/hooks/useFlash.ts`**

```ts
import { useEffect, useState } from "react";
import type { FlashProgress, FlashResult } from "../types";
import { flashFirmware, onFlashProgress } from "../lib/ipc";

export function useFlash() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [result, setResult] = useState<FlashResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onFlashProgress(setProgress).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const run = async (serial: string, url: string, partition?: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await flashFirmware(serial, url, partition));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return { running, progress, result, error, run };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useFlash.ts
git commit -m "feat(frontend): add flash ipc wrappers and hook"
```

---

### Task 4: Frontend — Flash Firmware button + modal in `DevicePanel`

**Files:**
- Modify: `src/components/DevicePanel.tsx` (add Flash Firmware button in Fastboot panel + flash modal)

**Interfaces:**
- Consumes: `useFlash` (Task 3), existing `connectionMode`/`connectionSerial` props, `device` prop.
- Produces: Flash Firmware button (Fastboot mode) + modal (pre-filled model, URL, optional partition, double confirmation, progress, reboot).

- [ ] **Step 1: Update `DevicePanel.tsx`**

Add imports:

```tsx
import { useFlash } from "../hooks/useFlash";
import type { ConnectionMode, DeviceInfo, Platform } from "../types";
```

Add state + hook:

```tsx
  const [flashOpen, setFlashOpen] = useState(false);
  const [flashUrl, setFlashUrl] = useState("");
  const [flashPartition, setFlashPartition] = useState("");
  const [flashConfirmOpen, setFlashConfirmOpen] = useState(false);
  const { running: flashRunning, progress: flashProgress, result: flashResult, error: flashError, run: flashRun } = useFlash();
```

Add the Flash Firmware button to the Fastboot panel (next to Format Userdata / Reboot / Detectar estado):

```tsx
          <button
            onClick={() => setFlashOpen(true)}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Flash Firmware
          </button>
```

Add the flash modal (before the MTP guide modal or at the end near other modals). It has two stages: the config form (`flashOpen`) and the confirmation (`flashConfirmOpen`). Pre-fill the model: use `device?.model` if present, else `connectionSerial`. The confirm button calls `flashRun(connectionSerial ?? "", flashUrl, flashPartition || undefined)`.

```tsx
      {flashOpen && connectionSerial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Flash de Firmware</h3>
            <p className="mt-2 text-xs text-muted">
              Dispositivo: <span className="font-mono text-fg">{connectionSerial}</span>
              {device?.model ? ` (${device.model})` : ""}
            </p>
            <label className="mt-3 block text-xs text-muted">URL da ROM</label>
            <input
              value={flashUrl}
              onChange={(e) => setFlashUrl(e.target.value)}
              placeholder="https://.../rom.zip"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <label className="mt-3 block text-xs text-muted">
              Partição (opcional — detectada do arquivo se vazio)
            </label>
            <input
              value={flashPartition}
              onChange={(e) => setFlashPartition(e.target.value)}
              placeholder="ex: boot, recovery, vbmeta"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            {flashError && (
              <div className="mt-2 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
                {flashError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFlashOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={() => setFlashConfirmOpen(true)}
                disabled={!flashUrl || flashRunning}
                className="rounded bg-accent-samsung px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {flashConfirmOpen && connectionSerial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar Flash</h3>
            <p className="mt-2 text-sm text-log-warn">
              O flash pode danificar o aparelho se a ROM for incompatível com{" "}
              <strong>{device?.model || connectionSerial}</strong>.
            </p>
            <p className="mt-2 text-xs text-muted">Firmware: <span className="font-mono text-fg">{flashUrl}</span></p>
            <p className="mt-1 text-xs text-muted">
              Partição: <span className="font-mono text-fg">{flashPartition || "auto (do arquivo)"}</span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFlashConfirmOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  setFlashConfirmOpen(false);
                  setFlashOpen(false);
                  flashRun(connectionSerial, flashUrl, flashPartition || undefined);
                }}
                disabled={flashRunning}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
              >
                Confirmar Flash
              </button>
            </div>
          </div>
        </div>
      )}

      {flashRunning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Flashando...</h3>
            <div className="mt-3 h-2 w-full overflow-hidden rounded bg-border">
              <div
                className="h-full bg-accent-samsung transition-all"
                style={{ width: `${flashProgress?.percent ?? 0}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-fg">{flashProgress?.message ?? "Preparando..."}</p>
          </div>
        </div>
      )}

      {flashResult && !flashRunning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">
              {flashResult.success ? "Flash concluído" : "Falha no flash"}
            </h3>
            <p className={`mt-2 text-sm ${flashResult.success ? "text-log-ok" : "text-log-error"}`}>
              {flashResult.message}
            </p>
            {flashResult.success && (
              <button
                onClick={() => fastbootReboot(connectionSerial)}
                className="mt-4 rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Reiniciar
              </button>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setFlashOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
```

Note: `fastbootReboot` must be imported (verify it exists in ipc.ts — it does from the fastboot feature). Ensure no unused imports.

- [ ] **Step 2: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```powershell
git add src/components/DevicePanel.tsx
git commit -m "feat(frontend): add flash firmware button and modal"
```

---

### Task 5: End-to-end verification + README

**Files:**
- Modify: `README.md` (document flash)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 42 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Update `README.md`**

Append to the README:

```markdown
## Flash de Firmware

No painel Fastboot, o botão **Flash Firmware** permite baixar e flashar firmware:

1. O app pré-preenche o modelo do aparelho.
2. Informe a URL da ROM (um arquivo `.img` ou ZIP de firmware fastboot).
3. Opcionalmente informe a partição (ex: boot, recovery, vbmeta) — se vazio, é detectada do arquivo.
4. Confirme a operação (aviso de incompatibilidade + partições).
5. Acompanhe o progresso e, ao final, reinicie o aparelho.

O flash para na primeira falha de partição (evita brick). O download é feito para uma pasta temporária e removido ao final.
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document flash firmware operation"
```

- [ ] **Step 5: Manual smoke test (optional, requires a connected device + ROM URL)**

Run:
```powershell
npm run tauri dev
```
Expected: Fastboot panel shows Flash Firmware; the modal pre-fills the model, accepts a URL, double-confirmation works, progress appears, reboot offered. Skip if no device/ROM — note it in the report.

---

## Self-Review Checklist

- [ ] Spec coverage: deps + partition detection TDD (Task 1), flash_from_url + fastboot_flash + command (Task 2), frontend types/ipc/hook (Task 3), Flash modal (Task 4), verification (Task 5). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `FlashResult`/`FlashProgress` fields match between `flashing.rs` and `types.ts`; `flash_firmware` ↔ `flashFirmware`; event `flash-progress` matches; `detect_partition_from_filename` call with stem (no extension) in `flash_from_url` matches the Task 1 implementation.
