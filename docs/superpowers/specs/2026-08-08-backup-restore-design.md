# OnLock Suite — Backup e Restauração de Dados (Design)

Data: 2026-08-08

## Objetivo

Adicionar a primeira operação do catálogo "vendável" e 100% legal do OnLock Suite: backup e restauração de dados do aparelho via adb (protocolo público). Assistências técnicas usam isso para proteger dados do cliente antes de reparos. A operação permite escolher categorias, destino no PC, progresso em tempo real e cancelamento, seguindo o padrão arquitetural já estabelecido no projeto (módulos isolados e testáveis + frontend React).

## Decisões de abordagem

- A1 — Módulo dedicado `backup.rs` (padrão `operations.rs`/`adb_controller.rs`).
- Backup via `adb pull` de pastas públicas + `content provider` para contatos/SMS (sem root, confiável).
- Seletor de categorias (checkboxes) + destino escolhido via diálogo nativo (tauri-plugin-dialog).
- Progresso por arquivo com cancelamento cooperativo (AtomicBool em tauri::State).
- Restauração completa: mídia via `adb push`; contatos via intent `.vcf` (com confirmação no aparelho); SMS via `.xml` + orientação ao app nativo (limitação documentada, sem root).
- Tudo legal: apenas protocolos públicos (adb), nenhum DA/exploit proprietário.

## Arquitetura

- **Novo módulo Rust `backup.rs`**:
  - `BackupCategory` enum: `Photos`, `Videos`, `Music`, `Downloads`, `Documents`, `Contacts`, `Sms` (derive `Debug`, `Clone`, `Serialize`, `Deserialize`, `PartialEq`).
  - `backup_categories() -> Vec<BackupCategory>` — função pura testável (categorias + descrições pt-BR via `category_label`).
  - `category_to_device_paths(cat) -> Vec<String>` — função pura testável mapeando categoria → caminhos/URIs remotos.
  - `compute_percent(files_done: usize, total: usize) -> u8` — função pura testável.
  - `BackupProgress { category: String, file: String, files_done: usize, total_files: usize, percent: u8 }` (Serialize) — emitido via evento `backup-progress`.
  - `BackupResult { serial: String, destination: String, categories_done: Vec<String>, files_copied: usize, message: String }` (Serialize).
  - `BackupManager` — executa backup/restauração via `AdbController`, emite progresso, respeita flag de cancelamento.
- **`adb_controller.rs`**: novos helpers `adb_pull(serial, remote, local)`, `adb_push(serial, local, remote)`, `list_remote_dir(serial, path)`.
- **`commands.rs`**: `run_backup(serial, categories, destination)`, `restore_backup(serial, destination, categories)`, `cancel_backup()`.
- **`lib.rs`**: registrar comandos + `tauri_plugin_dialog::init()` + state `CancelFlag` (AtomicBool).

## Mapeamento de Categorias (`category_to_device_paths`)

- `Photos` → `/sdcard/DCIM`, `/sdcard/Pictures`
- `Videos` → `/sdcard/DCIM/Camera`, `/sdcard/Movies` (DCIM/Camera já coberto por Photos; mapeamento mantém `Movies` e `DCIM/Camera`)
- `Music` → `/sdcard/Music`, `/sdcard/Notifications`, `/sdcard/Ringtones`
- `Downloads` → `/sdcard/Download`
- `Documents` → `/sdcard/Documents`
- `Contacts` → content provider `content://contacts/contacts/export` → arquivo `.vcf` local
- `Sms` → content provider `content://sms` via `adb exec-out content query` → `.xml` local

Observação: o mapeamento cobre as pastas públicas padrão do Android; pastas específicas podem não existir em todos os aparelhos (o backup tolera pastas ausentes).

## Fluxo de Dados

### Backup
1. `run_backup(serial, categories, destination)` valida serial + destino existente.
2. Para cada categoria:
   - `category_to_device_paths` → caminhos remotos.
   - `list_remote_dir` conta arquivos (total para progresso).
   - `adb_pull` de cada arquivo/pasta para `destination/<serial>/<categoria>/`.
   - Contatos/SMS: `adb exec-out` via content provider → arquivo local.
   - Emite `backup-progress` por arquivo (categoria, arquivo, X/Y, %).
3. Ao final: `BackupResult`.
4. Falha de arquivo individual → WARN + continua; pasta ausente → INFO + pula; falha ao listar → ERROR da categoria + segue.

### Restauração
1. `restore_backup(serial, destination, categories)`.
2. Mídia: `adb_push` de volta para as pastas públicas.
3. Contatos: abre `.vcf` via `adb shell am start` com intent `ACTION_VIEW` + `MIME text/x-vcard` → exige confirmação do usuário no aparelho (documentado).
4. SMS: sem root, sem push confiável → o app copia o `.xml` para `/sdcard/Download/` e orienta o usuário a restaurar pelo app nativo/Google; log WARN com a limitação.

### Cancelamento
- `cancel_backup()` seta `CancelFlag` (AtomicBool em State).
- Loop de cópia checa a flag entre arquivos; se cancelado, para e retorna `BackupResult` com mensagem "cancelado" e `files_copied` parcial (preserva o copiado).
- `cancel_backup` idempotente.

## Frontend e UI

- **Modal "Backup / Restauração"** acessível da seção Operações do `DevicePanel`:
  - **Guia Backup:** checkboxes das categorias (labels pt-BR), diálogo nativo de pasta destino, botão "Iniciar backup".
  - **Guia Restauração:** categorias a restaurar + destino de origem.
  - **Progresso:** barra (%), texto "Copiando <arquivo>", contagem "arquivo X de Y", botão "Cancelar".
  - **Resultado:** resumo (categorias, arquivos, destino) + logs no console.
- **`useBackup` hook** (novo): `{ running, progress, result, error, categories, run, cancel, restore }`, assina `backup-progress`.
- **`lib/ipc.ts`**: `runBackup(serial, categories, destination)`, `restoreBackup(...)`, `cancelBackup()`, `onBackupProgress(cb)`.
- **`types.ts`**: `BackupCategory`, `BackupProgress`, `BackupResult`.
- **`DevicePanel.tsx`**: botão "Backup / Restauração" + modal.

## Testes

- `cargo test` em `backup.rs`:
  - `backup_categories()` retorna as categorias com labels pt-BR.
  - `category_to_device_paths()` mapeia corretamente cada categoria.
  - `compute_percent()` calcula porcentagem (0%, 100%, valores intermediários, divisão por zero → 0).
  - `BackupResult`/`BackupProgress` montagem.
- Helpers `adb_pull`/`adb_push`/`list_remote_dir` não são unit-tested (requerem aparelho).
- Testes existentes (22) permanecem.

## Configuração

- `Cargo.toml`: adicionar `tauri-plugin-dialog = "2"`.
- `capabilities/default.json`: adicionar permissão `dialog:default`.
- Frontend: `npm install @tauri-apps/plugin-dialog`.
- Sem outras mudanças de config (adb já configurado via sidecar).

## Estrutura de Arquivos

```
src-tauri/
├─ src/backup.rs           # NOVO — BackupCategory, mapeamento, compute_percent, BackupManager
├─ src/adb_controller.rs   # + adb_pull, adb_push, list_remote_dir
├─ src/commands.rs         # + run_backup, restore_backup, cancel_backup
└─ src/lib.rs              # registrar comandos + plugin dialog + state CancelFlag
src/
├─ hooks/useBackup.ts      # NOVO
├─ lib/ipc.ts              # + runBackup, restoreBackup, cancelBackup, onBackupProgress
├─ types.ts                # + BackupCategory, BackupProgress, BackupResult
└─ components/DevicePanel.tsx  # + modal Backup/Restauração
```

## Limitações Documentadas (não são bugs)

- **SMS sem root:** restauração direta não é possível; o app exporta o `.xml` e orienta o uso do app nativo.
- **Contatos:** restauração via `.vcf` exige confirmação do usuário na tela do aparelho.
- **WhatsApp:** backup via `run-as` é frágil e fora de escopo desta fase (documentado no README, não implementado).
- **Backup criptografado:** fora de escopo.

## Fora de Escopo (fase atual)

- Backup/restauração de apps (apks), dados de app via `run-as`, criptografia do backup.
- Desbloqueios via DA/exploits proprietários (mantido fora por decisão estratégica — produto legal).
