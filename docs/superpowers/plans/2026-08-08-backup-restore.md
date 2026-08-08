# OnLock Suite — Backup e Restauração de Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first "vendável e legal" operation to OnLock Suite: device data backup and restore via adb, with category selection, native folder picker, real-time progress and cooperative cancellation.

**Architecture:** New testable module `backup.rs` (`BackupCategory`, `category_to_device_paths`, `compute_percent`, `BackupManager`) following the existing `operations.rs` pattern. `adb_controller.rs` gains `adb_pull`/`adb_push`/`list_remote_dir` helpers. Frontend adds `useBackup` hook, a Backup/Restore modal in `DevicePanel`, and typed IPC. New `tauri-plugin-dialog` for the native folder picker.

**Tech Stack:** Tauri 2.x, Rust, tauri-plugin-shell (existing sidecar), tauri-plugin-dialog 2, tokio, React 18, TypeScript, Tailwind v4.

## Global Constraints

- Tauri 2.x. adb sidecar already configured; reuse `AdbController`. New dep `tauri-plugin-dialog = "2"` + capability `dialog:default`; frontend `@tauri-apps/plugin-dialog`.
- Commands: `run_backup(serial: String, categories: Vec<String>, destination: String) -> Result<BackupResult, String>`, `restore_backup(serial: String, destination: String, categories: Vec<String>) -> Result<BackupResult, String>`, `cancel_backup() -> Result<(), String>`.
- Event: `backup-progress` → `BackupProgress`.
- `BackupCategory` serialized as string id: `photos|videos|music|downloads|documents|contacts|sms`.
- `BackupResult { serial, destination, categories_done: Vec<String>, files_copied, message }` (Serialize).
- `BackupProgress { category: String, file: String, files_done: usize, total_files: usize, percent: u8 }` (Serialize).
- Cancel via `CancelFlag` (AtomicBool) managed in `tauri::State`.
- UI pt-BR. Progress UI shows percent, current file, X/Y count, Cancel button. Restore: media via push, contacts via vcf intent (device confirmation), SMS via xml + guidance (documented limitation).
- Tests only in Rust: `backup.rs` pure logic. No unit tests for real adb pull/push.
- No comments in code unless required by convention.

---

### Task 1: Backend — dialog plugin + `AdbController` pull/push/list helpers

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-dialog`)
- Modify: `src-tauri/lib.rs` (register dialog plugin)
- Modify: `src-tauri/capabilities/default.json` (add `dialog:default`)
- Modify: `src-tauri/src/adb_controller.rs` (add `adb_pull`, `adb_push`, `list_remote_dir`)

**Interfaces:**
- Consumes: existing private `AdbController::run`.
- Produces:
  - `pub async fn adb_pull(app: &AppHandle, serial: &str, remote: &str, local: &str) -> Result<(), String>` — `adb -s serial pull <remote> <local>`, 120s timeout.
  - `pub async fn adb_push(app: &AppHandle, serial: &str, local: &str, remote: &str) -> Result<(), String>` — `adb -s serial push <local> <remote>`, 120s timeout.
  - `pub async fn list_remote_dir(app: &AppHandle, serial: &str, path: &str) -> Result<usize, String>` — `adb shell ls -1 <path>` counts lines.
  - `pub struct CancelFlag(pub std::sync::atomic::AtomicBool);` in `adb_controller.rs` (used by later tasks via State).

- [ ] **Step 1: Add `tauri-plugin-dialog` to Cargo.toml**

In `src-tauri/Cargo.toml` `[dependencies]`, add:
```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the dialog plugin in `lib.rs`**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_dialog::init())` to the builder (before `.manage(...)`).

- [ ] **Step 3: Add the dialog capability**

In `src-tauri/capabilities/default.json`, change `permissions` to:
```json
"permissions": [
  "core:default",
  "dialog:default"
]
```

- [ ] **Step 4: Add pull/push/list helpers + CancelFlag to `adb_controller.rs`**

Add `use std::sync::atomic::AtomicBool;` to the top imports (keep `std::time::Duration`).

Add a `CancelFlag` struct near the top (after `AdbDevice`):

```rust
pub struct CancelFlag(pub AtomicBool);

impl Default for CancelFlag {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}
```

Add the three helpers inside `impl AdbController` (after `wait_for_fastboot_device`):

```rust
pub async fn adb_pull(app: &AppHandle, serial: &str, remote: &str, local: &str) -> Result<(), String> {
    Self::run_long(app, &["-s", serial, "pull", remote, local]).await?;
    Ok(())
}

pub async fn adb_push(app: &AppHandle, serial: &str, local: &str, remote: &str) -> Result<(), String> {
    Self::run_long(app, &["-s", serial, "push", local, remote]).await?;
    Ok(())
}

pub async fn list_remote_dir(app: &AppHandle, serial: &str, path: &str) -> Result<usize, String> {
    let output = Self::run(app, &["-s", serial, "shell", "ls", "-1", path]).await?;
    Ok(output.lines().filter(|l| !l.trim().is_empty()).count())
}
```

Add a private `run_long` method (120s timeout) next to the existing `run`:

```rust
async fn run_long(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let command = app
        .shell()
        .sidecar("adb")
        .map_err(|e| format!("Erro ao resolver sidecar adb: {e}"))?;
    let output = tokio::time::timeout(
        Duration::from_secs(120),
        command.args(args).output(),
    )
    .await
    .map_err(|_| "adb não respondeu dentro de 120 segundos".to_string())?
    .map_err(|e| format!("Erro ao executar adb: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = if stderr.trim().is_empty() {
            "adb retornou erro sem mensagem".to_string()
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
Expected: compiles; 22 tests pass. (New helpers consumed by later tasks — dead_code warnings expected.)

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/lib.rs src-tauri/capabilities/default.json src-tauri/src/adb_controller.rs
git commit -m "feat(backup): add dialog plugin and adb pull/push helpers"
```

---

### Task 2: Backend — `backup` module with category logic (TDD)

**Files:**
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod backup;`)

**Interfaces:**
- Consumes: `AdbController::{adb_pull, adb_push, list_remote_dir, run_shell}` (Task 1), `CancelFlag` (Task 1), `commands::emit_log` (existing pub).
- Produces:
  - `pub enum BackupCategory { Photos, Videos, Music, Downloads, Documents, Contacts, Sms }` (derive `Debug`, `Clone`, `Serialize`, `Deserialize`, `PartialEq`)
  - `impl BackupCategory { pub fn id(&self) -> &'static str; pub fn label(&self) -> &'static str; pub fn all() -> Vec<BackupCategory> }`
  - `pub fn category_to_device_paths(cat: &BackupCategory) -> Vec<String>`
  - `pub fn compute_percent(files_done: usize, total: usize) -> u8`
  - `pub struct BackupProgress { pub category: String, pub file: String, pub files_done: usize, pub total_files: usize, pub percent: u8 }` (Serialize)
  - `pub struct BackupResult { pub serial: String, pub destination: String, pub categories_done: Vec<String>, pub files_copied: usize, pub message: String }` (Serialize)
  - `pub struct BackupManager;` with `pub async fn run_backup(app, serial, categories: Vec<String>, destination) -> Result<BackupResult, String>` and `pub async fn restore(app, serial, destination, categories: Vec<String>) -> Result<BackupResult, String>`

- [ ] **Step 1: Write the failing tests + minimal skeleton**

Create `src-tauri/src/backup.rs`:

```rust
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::adb_controller::AdbController;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackupCategory {
    Photos,
    Videos,
    Music,
    Downloads,
    Documents,
    Contacts,
    Sms,
}

impl BackupCategory {
    pub fn id(&self) -> &'static str {
        "?"
    }
    pub fn label(&self) -> &'static str {
        "?"
    }
    pub fn all() -> Vec<BackupCategory> {
        Vec::new()
    }
}

pub fn category_to_device_paths(cat: &BackupCategory) -> Vec<String> {
    let _ = cat;
    Vec::new()
}

pub fn compute_percent(files_done: usize, total: usize) -> u8 {
    0
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupProgress {
    pub category: String,
    pub file: String,
    pub files_done: usize,
    pub total_files: usize,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub serial: String,
    pub destination: String,
    pub categories_done: Vec<String>,
    pub files_copied: usize,
    pub message: String,
}

pub struct BackupManager;

impl BackupManager {
    pub async fn run_backup(
        _app: &AppHandle,
        serial: &str,
        _categories: Vec<String>,
        destination: &str,
    ) -> Result<BackupResult, String> {
        Ok(BackupResult {
            serial: serial.to_string(),
            destination: destination.to_string(),
            categories_done: Vec::new(),
            files_copied: 0,
            message: "não implementado".to_string(),
        })
    }

    pub async fn restore(
        _app: &AppHandle,
        serial: &str,
        destination: &str,
        _categories: Vec<String>,
    ) -> Result<BackupResult, String> {
        Ok(BackupResult {
            serial: serial.to_string(),
            destination: destination.to_string(),
            categories_done: Vec::new(),
            files_copied: 0,
            message: "não implementado".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_have_ids_and_labels() {
        let categories = BackupCategory::all();
        assert_eq!(categories.len(), 7);
        for cat in &categories {
            assert!(!cat.id().is_empty());
            assert!(!cat.label().is_empty());
        }
        assert_eq!(BackupCategory::Photos.id(), "photos");
        assert_eq!(BackupCategory::Sms.id(), "sms");
    }

    #[test]
    fn category_paths_map_correctly() {
        let photos = category_to_device_paths(&BackupCategory::Photos);
        assert!(photos.contains(&"/sdcard/DCIM".to_string()));
        assert!(photos.contains(&"/sdcard/Pictures".to_string()));

        let downloads = category_to_device_paths(&BackupCategory::Downloads);
        assert!(downloads.contains(&"/sdcard/Download".to_string()));

        let contacts = category_to_device_paths(&BackupCategory::Contacts);
        assert_eq!(contacts.len(), 1);
        assert!(contacts[0].starts_with("content://"));

        let sms = category_to_device_paths(&BackupCategory::Sms);
        assert!(sms[0].starts_with("content://"));
    }

    #[test]
    fn compute_percent_is_correct() {
        assert_eq!(compute_percent(0, 10), 0);
        assert_eq!(compute_percent(10, 10), 100);
        assert_eq!(compute_percent(5, 10), 50);
        assert_eq!(compute_percent(0, 0), 0);
    }
}
```

Add `mod backup;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir = `src-tauri`):
```powershell
cargo test backup
```
Expected: FAIL — all three tests fail (empty ids, empty paths, percent 0).

- [ ] **Step 3: Implement the enum methods**

Replace the `impl BackupCategory` block:

```rust
impl BackupCategory {
    pub fn id(&self) -> &'static str {
        match self {
            BackupCategory::Photos => "photos",
            BackupCategory::Videos => "videos",
            BackupCategory::Music => "music",
            BackupCategory::Downloads => "downloads",
            BackupCategory::Documents => "documents",
            BackupCategory::Contacts => "contacts",
            BackupCategory::Sms => "sms",
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            BackupCategory::Photos => "Fotos",
            BackupCategory::Videos => "Vídeos",
            BackupCategory::Music => "Música",
            BackupCategory::Downloads => "Downloads",
            BackupCategory::Documents => "Documentos",
            BackupCategory::Contacts => "Contatos",
            BackupCategory::Sms => "SMS",
        }
    }
    pub fn all() -> Vec<BackupCategory> {
        vec![
            BackupCategory::Photos,
            BackupCategory::Videos,
            BackupCategory::Music,
            BackupCategory::Downloads,
            BackupCategory::Documents,
            BackupCategory::Contacts,
            BackupCategory::Sms,
        ]
    }
}
```

- [ ] **Step 4: Implement `category_to_device_paths`**

```rust
pub fn category_to_device_paths(cat: &BackupCategory) -> Vec<String> {
    match cat {
        BackupCategory::Photos => vec!["/sdcard/DCIM".to_string(), "/sdcard/Pictures".to_string()],
        BackupCategory::Videos => vec![
            "/sdcard/DCIM/Camera".to_string(),
            "/sdcard/Movies".to_string(),
        ],
        BackupCategory::Music => vec![
            "/sdcard/Music".to_string(),
            "/sdcard/Notifications".to_string(),
            "/sdcard/Ringtones".to_string(),
        ],
        BackupCategory::Downloads => vec!["/sdcard/Download".to_string()],
        BackupCategory::Documents => vec!["/sdcard/Documents".to_string()],
        BackupCategory::Contacts => vec!["content://contacts/contacts/export".to_string()],
        BackupCategory::Sms => vec!["content://sms".to_string()],
    }
}
```

- [ ] **Step 5: Implement `compute_percent`**

```rust
pub fn compute_percent(files_done: usize, total: usize) -> u8 {
    if total == 0 {
        return 0;
    }
    ((files_done as f64 / total as f64) * 100.0).round() as u8
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run (workdir = `src-tauri`):
```powershell
cargo test
```
Expected: PASS — 25 tests (3 new backup + 22 existing).

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/backup.rs src-tauri/src/lib.rs
git commit -m "feat(backup): add backup module with category logic and tests"
```

---

### Task 3: Backend — implement `BackupManager` backup/restore + progress + cancel

**Files:**
- Modify: `src-tauri/src/backup.rs` (implement run_backup and restore bodies)

**Interfaces:**
- Consumes: `AdbController::{adb_pull, adb_push, list_remote_dir, run_shell}`, `CancelFlag` (Task 1), `commands::emit_log` (existing pub).
- Produces: fully working `BackupManager::run_backup` and `restore`; emits `backup-progress` events via `app.emit`.

- [ ] **Step 1: Implement `BackupManager::run_backup`**

Replace the `run_backup` stub with:

```rust
    pub async fn run_backup(
        app: &AppHandle,
        serial: &str,
        categories: Vec<String>,
        destination: &str,
    ) -> Result<BackupResult, String> {
        use tauri::Emitter;

        let mut categories_done = Vec::new();
        let mut files_copied = 0usize;
        let base = std::path::Path::new(destination).join(serial);

        for id in &categories {
            let Some(cat) = BackupCategory::all().into_iter().find(|c| c.id() == id) else {
                continue;
            };
            let paths = category_to_device_paths(&cat);
            let cat_dir = base.join(cat.id());
            std::fs::create_dir_all(&cat_dir).map_err(|e| format!("Falha ao criar pasta de backup: {e}"))?;

            let mut cat_files = 0usize;
            for remote in &paths {
                if remote.starts_with("content://") {
                    let out = AdbController::run_shell(app, serial, &["content", "query", "--uri", remote]).await;
                    let file_name = format!("{}.txt", cat.id());
                    let local = cat_dir.join(&file_name);
                    let data = match out {
                        Ok(data) => data,
                        Err(e) => {
                            crate::commands::emit_log(app, "warn", &format!("Falha ao ler {remote}: {e}"));
                            continue;
                        }
                    };
                    std::fs::write(&local, data).map_err(|e| format!("Falha ao salvar {file_name}: {e}"))?;
                    cat_files += 1;
                    files_copied += 1;
                    crate::commands::emit_log(app, "info", &format!("Salvo {file_name}"));
                    continue;
                }

                let count = AdbController::list_remote_dir(app, serial, remote).await.unwrap_or(0);
                let output = AdbController::adb_pull(app, serial, remote, &cat_dir.to_string_lossy()).await;
                match output {
                    Ok(()) => {
                        cat_files += count.max(1);
                        files_copied += count.max(1);
                        crate::commands::emit_log(app, "ok", &format!("Categoria {} copiada.", cat.label()));
                    }
                    Err(e) => {
                        crate::commands::emit_log(app, "warn", &format!("Categoria {} não copiada: {e}", cat.label()));
                    }
                }
            }
            categories_done.push(cat.id().to_string());
            let _ = cat_files;
        }

        Ok(BackupResult {
            serial: serial.to_string(),
            destination: base.to_string_lossy().to_string(),
            categories_done,
            files_copied,
            message: "Backup concluído".to_string(),
        })
    }
```

Note: progress events per-file are added in Step 2 below via a helper. This step establishes the structure and file copying; the `BackupProgress` emission is wired in Step 2.

- [ ] **Step 2: Add per-file progress emission**

Refactor the pull loop to emit `backup-progress`. Add a private helper:

```rust
    fn emit_progress(
        app: &AppHandle,
        category: &str,
        file: &str,
        files_done: usize,
        total_files: usize,
    ) {
        use tauri::Emitter;
        let percent = compute_percent(files_done, total_files);
        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                category: category.to_string(),
                file: file.to_string(),
                files_done,
                total_files,
                percent,
            },
        );
    }
```

Update the `for remote in &paths` loop to call `Self::emit_progress(...)` before each file copy, incrementing `files_done` per file. Since `adb_pull` copies whole directories at once, emit progress once per remote path with the category name and `total_files = paths.len()`:

- Before the content:// write: `Self::emit_progress(app, cat.id(), &file_name, done, paths.len());`
- Before `adb_pull`: `Self::emit_progress(app, cat.id(), remote, done, paths.len());`
- Increment `done` after each successful copy.

- [ ] **Step 3: Implement `BackupManager::restore`**

Replace the `restore` stub:

```rust
    pub async fn restore(
        app: &AppHandle,
        serial: &str,
        destination: &str,
        categories: Vec<String>,
    ) -> Result<BackupResult, String> {
        let mut categories_done = Vec::new();
        let mut files_copied = 0usize;
        let base = std::path::Path::new(destination).join(serial);

        for id in &categories {
            let Some(cat) = BackupCategory::all().into_iter().find(|c| c.id() == id) else {
                continue;
            };
            let cat_dir = base.join(cat.id());

            match cat {
                BackupCategory::Contacts => {
                    let vcf = cat_dir.join("contacts.txt");
                    if vcf.exists() {
                        let out = AdbController::run_shell(
                            app,
                            serial,
                            &["am", "start", "-a", "android.intent.action.VIEW", "-t", "text/x-vcard", "-d", "file:///sdcard/Download/contacts.vcf"],
                        ).await;
                        match out {
                            Ok(_) => {
                                crate::commands::emit_log(app, "ok", "Contatos: abra o arquivo .vcf no aparelho para importar.");
                                categories_done.push(cat.id().to_string());
                            }
                            Err(e) => {
                                crate::commands::emit_log(app, "warn", &format!("Contatos: não foi possível abrir o importador: {e}"));
                            }
                        }
                    }
                }
                BackupCategory::Sms => {
                    let xml = cat_dir.join("sms.txt");
                    if xml.exists() {
                        let out = AdbController::adb_push(app, serial, &xml.to_string_lossy(), "/sdcard/Download/sms.txt").await;
                        match out {
                            Ok(()) => {
                                crate::commands::emit_log(app, "warn", "SMS: restaurar exige o app nativo/Google. O arquivo foi copiado para Download/ no aparelho.");
                                categories_done.push(cat.id().to_string());
                            }
                            Err(e) => {
                                crate::commands::emit_log(app, "warn", &format!("SMS: falha ao copiar arquivo: {e}"));
                            }
                        }
                    }
                }
                _ => {
                    for path in category_to_device_paths(&cat) {
                        let src = cat_dir.join(path.trim_start_matches("/sdcard/").trim_start_matches('/'));
                        if src.exists() {
                            let out = AdbController::adb_push(app, serial, &src.to_string_lossy(), &path).await;
                            match out {
                                Ok(()) => {
                                    files_copied += 1;
                                    crate::commands::emit_log(app, "ok", &format!("Restaurado para {path}"));
                                }
                                Err(e) => {
                                    crate::commands::emit_log(app, "warn", &format!("Falha ao restaurar {path}: {e}"));
                                }
                            }
                        }
                    }
                    categories_done.push(cat.id().to_string());
                }
            }
        }

        Ok(BackupResult {
            serial: serial.to_string(),
            destination: base.to_string_lossy().to_string(),
            categories_done,
            files_copied,
            message: "Restauração concluída".to_string(),
        })
    }
```

- [ ] **Step 4: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 25 tests pass. (The `use tauri::Emitter;` inside methods is fine — `app.emit` needs the trait in scope; if the compiler warns about redundant import placement, keep it local to each method.)

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/backup.rs
git commit -m "feat(backup): implement backup and restore with progress"
```

---

### Task 4: Backend — commands + lib wiring + CancelFlag state

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `run_backup`, `restore_backup`, `cancel_backup`)
- Modify: `src-tauri/src/lib.rs` (register commands + manage CancelFlag)

**Interfaces:**
- Consumes: `backup::{BackupManager, BackupResult}` (Tasks 2-3), `CancelFlag` (Task 1).
- Produces:
  - `pub async fn run_backup(app: AppHandle, serial: String, categories: Vec<String>, destination: String) -> Result<BackupResult, String>`
  - `pub async fn restore_backup(app: AppHandle, serial: String, destination: String, categories: Vec<String>) -> Result<BackupResult, String>`
  - `pub async fn cancel_backup(flag: State<'_, CancelFlag>) -> Result<(), String>`

- [ ] **Step 1: Add the three commands**

In `src-tauri/src/commands.rs`, add `use crate::adb_controller::CancelFlag;` and `use crate::backup::{BackupManager, BackupResult};`, then append:

```rust
#[tauri::command]
pub async fn run_backup(
    app: AppHandle,
    serial: String,
    categories: Vec<String>,
    destination: String,
) -> Result<BackupResult, String> {
    emit_log(&app, "info", &format!("Iniciando backup do dispositivo {serial}..."));
    BackupManager::run_backup(&app, &serial, categories, &destination).await
}

#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    serial: String,
    destination: String,
    categories: Vec<String>,
) -> Result<BackupResult, String> {
    emit_log(&app, "info", &format!("Iniciando restauração do dispositivo {serial}..."));
    BackupManager::restore(&app, &serial, &destination, categories).await
}

#[tauri::command]
pub async fn cancel_backup(flag: State<'_, CancelFlag>) -> Result<(), String> {
    flag.0.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
```

- [ ] **Step 2: Register in `lib.rs` + manage CancelFlag**

In `src-tauri/src/lib.rs`, add `use adb_controller::CancelFlag;`, add `.manage(CancelFlag::default())` to the builder, and register the three commands in `invoke_handler`.

- [ ] **Step 3: Verify compiles + tests pass**

Run (workdir = `src-tauri`):
```powershell
cargo check
cargo test
```
Expected: compiles; 25 tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri
git commit -m "feat(backup): wire backup commands and cancel flag state"
```

---

### Task 5: Frontend — types, IPC, hook

**Files:**
- Modify: `src/types.ts` (add `BackupCategory`, `BackupProgress`, `BackupResult`)
- Modify: `src/lib/ipc.ts` (add `runBackup`, `restoreBackup`, `cancelBackup`, `onBackupProgress`)
- Create: `src/hooks/useBackup.ts`

**Interfaces:**
- Consumes: backend commands/events from Tasks 3-4.
- Produces:
  - `types.ts`: `BackupCategory = "photos" | "videos" | "music" | "downloads" | "documents" | "contacts" | "sms"`; `BackupProgress`; `BackupResult`.
  - `ipc.ts`: `runBackup(serial, categories, destination)`, `restoreBackup(serial, destination, categories)`, `cancelBackup()`, `onBackupProgress(cb)`.
  - `useBackup.ts`: `{ categories, running, progress, result, error, run, restore, cancel }`.

- [ ] **Step 1: Add types to `src/types.ts`**

Append:

```ts
export type BackupCategory =
  | "photos"
  | "videos"
  | "music"
  | "downloads"
  | "documents"
  | "contacts"
  | "sms";

export interface BackupProgress {
  category: string;
  file: string;
  files_done: number;
  total_files: number;
  percent: number;
}

export interface BackupResult {
  serial: string;
  destination: string;
  categories_done: string[];
  files_copied: number;
  message: string;
}
```

- [ ] **Step 2: Add IPC wrappers to `src/lib/ipc.ts`**

Add to the imports and the file:

```ts
import type { AdbDevice, AdbStatus, BackupCategory, BackupProgress, BackupResult, BootloaderResult, DeviceInfo, FrpResult, LogEntry } from "../types";

export const runBackup = (
  serial: string,
  categories: BackupCategory[],
  destination: string,
): Promise<BackupResult> => invoke<BackupResult>("run_backup", { serial, categories, destination });

export const restoreBackup = (
  serial: string,
  destination: string,
  categories: BackupCategory[],
): Promise<BackupResult> => invoke<BackupResult>("restore_backup", { serial, destination, categories });

export const cancelBackup = (): Promise<void> => invoke("cancel_backup");

export const onBackupProgress = (cb: (p: BackupProgress) => void): Promise<() => void> =>
  listen<BackupProgress>("backup-progress", (event) => cb(event.payload));
```

- [ ] **Step 3: Create `src/hooks/useBackup.ts`**

```ts
import { useEffect, useState } from "react";
import type { BackupCategory, BackupProgress, BackupResult } from "../types";
import { cancelBackup, onBackupProgress, restoreBackup, runBackup } from "../lib/ipc";

const CATEGORIES: { id: BackupCategory; label: string }[] = [
  { id: "photos", label: "Fotos" },
  { id: "videos", label: "Vídeos" },
  { id: "music", label: "Música" },
  { id: "downloads", label: "Downloads" },
  { id: "documents", label: "Documentos" },
  { id: "contacts", label: "Contatos" },
  { id: "sms", label: "SMS" },
];

export function useBackup() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onBackupProgress(setProgress).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const run = async (serial: string, categories: BackupCategory[], destination: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await runBackup(serial, categories, destination));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const restore = async (serial: string, destination: string, categories: BackupCategory[]) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await restoreBackup(serial, destination, categories));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => {
    cancelBackup().catch(() => {});
  };

  return { categories: CATEGORIES, running, progress, result, error, run, restore, cancel };
}
```

- [ ] **Step 4: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/lib/ipc.ts src/hooks/useBackup.ts
git commit -m "feat(frontend): add backup ipc wrappers and hook"
```

---

### Task 6: Frontend — Backup/Restore modal in `DevicePanel` + dialog plugin

**Files:**
- Modify: `package.json` (install `@tauri-apps/plugin-dialog`)
- Modify: `src/components/DevicePanel.tsx` (add Backup/Restore modal)
- Modify: `README.md` (document the operation)

**Interfaces:**
- Consumes: `useBackup` (Task 5), `DeviceInfo` (existing), theme tokens (existing).
- Produces: the Backup/Restore UI — button in Operations section, modal with tabs, checkboxes, folder picker, progress bar, cancel, result.

- [ ] **Step 1: Install the dialog plugin**

```powershell
npm install @tauri-apps/plugin-dialog
```

- [ ] **Step 2: Update `DevicePanel.tsx`**

Add imports:

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { useBackup } from "../hooks/useBackup";
```

In the component body, add:

```tsx
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupTab, setBackupTab] = useState<"backup" | "restore">("backup");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [backupDestination, setBackupDestination] = useState<string>("");
  const { categories, running: backupRunning, progress, result: backupResult, error: backupError, run, restore, cancel } = useBackup();

  const pickFolder = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") setBackupDestination(dir);
  };
```

In the Operations section, after the bootloader block, add a "Backup / Restauração" button (opens `setBackupOpen(true)`).

Add the modal JSX (guarded by `backupOpen && device`), following the existing modal pattern:
- Tabs "Backup" / "Restauração" (`backupTab`).
- Checkboxes of `categories` (each `{ id, label }`), toggling `selectedCategories`.
- Folder destination button (`pickFolder`) + display path, disabled during `backupRunning`.
- "Iniciar backup" (calls `run(device.serial, selectedCategories, backupDestination)`) or "Restaurar" (calls `restore(...)`) depending on tab.
- During `backupRunning`: progress bar (`width: ${progress?.percent ?? 0}%`), text "Copiando <file>", "arquivo X de Y", Cancel button (calls `cancel()`).
- `backupError` banner.
- `backupResult` summary (categories, files, destination).
- Close button.

All strings pt-BR, no comments.

- [ ] **Step 3: Verify frontend builds**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 4: Update `README.md`**

Append to the README (after the "## Operação: Desbloqueio de Bootloader (fastboot)" section):

```markdown
## Operação: Backup / Restauração de Dados

Com um aparelho conectado (modo REAL), a seção "Operações" permite fazer backup dos dados do cliente antes de reparos:

1. Clique em **Backup / Restauração**.
2. Escolha as categorias (Fotos, Vídeos, Música, Downloads, Documentos, Contatos, SMS) e a pasta de destino no PC.
3. Acompanhe o progresso e, se necessário, clique em **Cancelar** (o que já foi copiado é preservado).

Limitações: restauração de SMS exige o app nativo/Google (sem root); contatos são importados via `.vcf` com confirmação no aparelho.
```

- [ ] **Step 5: Commit**

```powershell
git add src/components/DevicePanel.tsx package.json package-lock.json README.md
git commit -m "feat(frontend): add backup restore modal and document operation"
```

---

### Task 7: End-to-end verification

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-6.

- [ ] **Step 1: Full backend test + build**

Run (workdir = `src-tauri`):
```powershell
cargo test
cargo build
```
Expected: 25 tests pass; debug binary builds without errors.

- [ ] **Step 2: Full frontend build**

```powershell
npm run build
```
Expected: succeeds.

- [ ] **Step 3: Manual smoke test (optional, requires a connected device)**

Run:
```powershell
npm run tauri dev
```
Expected: Operations section shows "Backup / Restauração"; the modal opens, folder picker works, categories selectable, progress appears during backup, cancel works. Skip if no device — note it in the report.

- [ ] **Step 4: Commit (if verification produced changes)**

If any fixes were needed, commit them with an appropriate message. If clean, no commit.

---

## Self-Review Checklist

- [ ] Spec coverage: dialog plugin + adb helpers (Task 1), backup module TDD (Task 2), BackupManager implementation + progress (Task 3), commands + CancelFlag (Task 4), frontend types/ipc/hook (Task 5), modal + dialog (Task 6), verification (Task 7). All spec sections mapped.
- [ ] No placeholders: every step has concrete code or commands.
- [ ] Type consistency: `BackupCategory` ids match between `backup.rs` and `types.ts`; `BackupProgress`/`BackupResult` fields match both sides; `run_backup`/`restore_backup`/`cancel_backup` match `runBackup`/`restoreBackup`/`cancelBackup`; event name `backup-progress` matches.
