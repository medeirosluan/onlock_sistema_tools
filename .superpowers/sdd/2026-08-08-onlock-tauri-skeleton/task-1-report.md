# Task 1 Report: Scaffold project + git init + dependency install

**Status:** DONE_WITH_CONCERNS

**Date:** 2026-08-08

**Environment:** Windows PowerShell 5.1, Node v22.16.0, npm 10.9.2, cargo/rustc 1.97.1, git 2.55.0.windows.2

---

## Commands run and key outputs

### Step 1: Scaffold into current directory

Command:
```powershell
npm create tauri-app@latest . -- --template react-ts --manager npm --identifier com.onlock.suite --yes --force
```

**First attempt FAILED:**
```
error: IO error: not a terminal
npm error code 1
```
create-tauri-app 4.6.2 rejects a non-TTY stdin even with `--yes --force`.

**Workaround (succeeded):**
```powershell
$input = "n`n"; $input | npx --yes create-tauri-app@latest . --template react-ts --manager npm --identifier com.onlock.suite --yes --force
```
Output: `Template created! To get started run: npm install ...`

Generated: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `src/`, `src-tauri/`, `.gitignore`, `README.md`, `.vscode/extensions.json`, `public/`.

### Step 2: Initialize git and commit the scaffold

Git repo was already initialized (no commits). Run:
```powershell
git add -A
git commit -m "chore: scaffold tauri 2 react-ts project with create-tauri-app"
```
Succeeded. 38 files committed.

**Scaffold commit:** `b247109`

A follow-up commit for dependency lockfiles was also made (see Concerns):
**Commit:** `87a1692 chore: commit dependency lockfiles` (package-lock.json, src-tauri/Cargo.lock)

### Step 3: Install frontend dependencies

```powershell
npm install
```
Output: `added 73 packages, and audited 74 packages in 9s ... found 0 vulnerabilities`

### Step 4: Verify backend compiles

```powershell
cargo check
```
(when run in `src-tauri`)
Output: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 1m 44s`
Last compiled line: `Compiling onlock_sistema_tools v0.1.0 (...)` — success, no errors.

### Step 5: Verify frontend builds

```powershell
npm run build
```
Output: `tsc && vite build` succeeded — 32 modules transformed, `dist/` created with `index.html`, CSS, and JS bundle. `✓ built in 890ms`.

---

## `[lib] name` and `main.rs` confirmation

**Cargo.toml:**
```toml
[package]
name = "onlock_sistema_tools"

[lib]
name = "onlock_sistema_tools_lib"
```

**src-tauri/src/main.rs:**
```rust
fn main() {
    onlock_sistema_tools_lib::run()
}
```
Both match the brief's expectation.

**Note:** create-tauri-app invoked with `.` as project name defaults the app/package name to `tauri-app`/`tauri_app_lib` instead of deriving it from the directory name. When the project name is passed explicitly (e.g. `onlock_sistema_tools`), it derives correctly. I corrected the naming manually in 5 files after scaffolding:
- `src-tauri/Cargo.toml`: `tauri-app` → `onlock_sistema_tools`, `tauri_app_lib` → `onlock_sistema_tools_lib`
- `src-tauri/src/main.rs`: `tauri_app_lib::run()` → `onlock_sistema_tools_lib::run()`
- `package.json`: name → `onlock_sistema_tools`
- `src-tauri/tauri.conf.json`: `productName` → `OnLock Suite`, window `title` → `OnLock Suite`

Verified `cargo check` compiles `onlock_sistema_tools` and `npm run build` runs against the renamed package, so the renames are consistent.

---

## Concerns

1. **DATA LOSS — pre-existing `docs/` and `.superpowers/` folders were DELETED.** The scaffold step with `.` + `--force` cleared the existing directory contents before generating, which removed:
   - `docs/superpowers/specs/2026-08-08-onlock-tauri-skeleton-design.md` (the design spec referenced by the brief — this file is now **unrecoverable**: no git history existed before the commit, and no copy was found anywhere on disk).
   - `.superpowers/sdd/2026-08-08-onlock-tauri-skeleton/task-1-brief.md` (I had already read it into context before it was deleted, so its contents are preserved here).
   - The `docs/` and `.superpowers/` directories themselves no longer exist at the project root.
   - **Recommendation:** the design spec must be regenerated/re-created by the plan owner, or recovered from wherever the plan was authored, before Tasks 2-7 rely on it.

2. **TTY workaround.** `npm create tauri-app@latest . -- --yes --force` fails under non-interactive shell with `IO error: not a terminal`; piping stdin (`"n`n"`) resolves it. This was necessary to complete the brief's Step 1 as written.

3. **Naming deviation.** Passing `.` produced `tauri-app` default naming rather than `onlock_sistema_tools`. Fixed manually (see above) to match the brief's expected values.

4. **Lockfile commit.** The brief's Step 2 commits before `npm install`/`cargo check`, so `package-lock.json` and `Cargo.lock` were generated afterward and committed separately in `87a1692`. If the plan prefers those in the scaffold commit, the history can be rewritten; left as-is to preserve the documented scaffold commit hash `b247109`.
