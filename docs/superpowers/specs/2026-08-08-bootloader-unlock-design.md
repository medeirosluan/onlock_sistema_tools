# OnLock Suite — Operação de Desbloqueio de Bootloader (fastboot) (Design)

Data: 2026-08-08

## Objetivo

Adicionar a segunda operação real ao OnLock Suite: desbloqueio do bootloader via modo fastboot, em fluxo guiado por etapas com confirmação obrigatória, verificação prévia do estado, fallback de comando e opção de reiniciar/re-detectar. Segue o mesmo padrão arquitetural e de UI da operação de remoção de FRP.

## Decisões de abordagem

- A1 — Estender `operations.rs` com `BootloaderUnlocker` (mesmo padrão do `FrpRemover`).
- Binário fastboot reusado do mesmo download do platform-tools (estender `download-adb.ps1` + `externalBin`), sem novo download.
- Comando: `fastboot flashing unlock` com fallback `fastboot oem unlock` para aparelhos antigos.
- Fluxo guiado por etapas com verificação prévia do estado e reinício/re-detecção após sucesso.
- Confirmação obrigatória na UI (mesmo modal do FRP).

## Arquitetura

- **`operations.rs`** estendido:
  - `BootloaderResult { serial: String, success: bool, steps_completed: usize, message: String }` (Serialize).
  - `BootloaderStep { id: &'static str, description: &'static str, essential: bool }` (Debug/Clone/PartialEq).
  - `bootloader_steps() -> Vec<BootloaderStep>` — função pura testável (5 etapas).
  - `bootloader_result(serial, success, steps_completed, message) -> BootloaderResult`.
  - `is_bootloader_unlocked(output: &str) -> bool` — parse puro da saída de `getvar unlocked`.
  - `BootloaderUnlocker::run(app, serial) -> Result<BootloaderResult, String>`.
- **`adb_controller.rs`** ganha helpers fastboot (reusando `run`):
  - `reboot_bootloader(serial)` — `adb reboot bootloader`.
  - `fastboot(serial, args)` — executa `fastboot <args>` via `Command::new_sidecar("fastboot")`.
  - `fastboot_reboot(serial)` — `fastboot reboot`.
- **`commands.rs`**: `unlock_bootloader(serial) -> Result<BootloaderResult, String>` e `fastboot_reboot(serial) -> Result<(), String>`.
- **Sidecar**: `download-adb.ps1` copia `fastboot.exe`; `tauri.conf.json` `externalBin` ganha `"binaries/fastboot"`. Fastboot não requer as DLLs adb.

## Sequência de Comandos (`bootloader_steps()` — 5 etapas)

1. **Verificação** — `fastboot getvar unlocked` (essencial). Se saída indica `unlocked`, log INFO "bootloader já desbloqueado" e retorna `BootloaderResult { success: true, message: "já desbloqueado" }` sem executar o desbloqueio.
2. **Modo fastboot** — `adb reboot bootloader` (essencial) + breve espera.
3. **Desbloqueio** — `fastboot flashing unlock` (essencial); em falha específica, fallback `fastboot oem unlock`. Log INFO do comando usado.
4. **Confirmação** — log orientando o usuário a confirmar na tela quando aplicável; re-tenta `getvar unlocked` para confirmar.
5. **Conclusão** — log OK "Bootloader desbloqueado" e `BootloaderResult { success: true }`.

- Etapas 1-4 essenciais: falha para a operação com log ERROR.
- Ação de "já desbloqueado" na etapa 1: não executa desbloqueio (evita apagar dados à toa).

## Fluxo de Dados e IPC

- Frontend chama `unlock_bootloader(serial)` (async); backend executa as etapas com `emit_log` por etapa em tempo real.
- Retorna `BootloaderResult`.
- Após sucesso, frontend oferece "Reiniciar aparelho" → `fastboot_reboot(serial)` (aparelho está em fastboot, não adb).
- Erros de adb/fastboot (sidecar/timeout) propagam `Err`; falha essencial logada e sinalizada.

## Frontend e UI

- Seção "Operações" do `DevicePanel` ganha o botão **"Desbloquear bootloader"** ao lado de "Remover FRP".
- Confirmação obrigatória (mesmo modal): serial, modelo, aviso "Esta operação desbloqueia o bootloader e apaga os dados do aparelho", lista dos comandos, Confirmar/Cancelar.
- Progresso via console de logs; estado local do `BootloaderResult`.
- Resultado: badge de sucesso/erro + mensagem; se sucesso, botão "Reiniciar aparelho" (fastboot reboot).
- Caso "já desbloqueado": mensagem informativa em vez de executar.
- **`useBootloader.ts`** (novo hook, mesmo padrão do `useFrp`): `{ running, result, error, confirming, setConfirming, run, reboot }`.
- **`lib/ipc.ts`**: `unlockBootloader(serial)`, `fastbootReboot(serial)`.
- **`types.ts`**: `BootloaderResult`.

## Testes

- `cargo test` em `operations.rs`:
  - `bootloader_steps()` — 5 etapas, ids/essential/descrições pt-BR corretos.
  - `bootloader_result()` — montagem sucesso/falha.
  - `is_bootloader_unlocked()` — fixtures de saída `getvar unlocked`: contém "unlocked"/"yes" → true; "locked"/"no"/vazio → false.
- Helpers fastboot não são unit-tested (requerem aparelho).
- Testes existentes (17) permanecem.

## Configuração

- `download-adb.ps1`: copiar `fastboot.exe` para `src-tauri/binaries/` (triple-suffixed: `fastboot-x86_64-pc-windows-msvc.exe`).
- `tauri.conf.json`: `bundle.externalBin` ganha `"binaries/fastboot"`.
- `.gitignore`: `src-tauri/binaries/` já coberto.
- Sem novas dependências.

## Estrutura de Arquivos

```
src-tauri/
├─ src/adb_controller.rs   # + reboot_bootloader, fastboot, fastboot_reboot
├─ src/operations.rs       # + BootloaderUnlocker, bootloader_steps, bootloader_result, is_bootloader_unlocked
├─ src/commands.rs         # + unlock_bootloader, fastboot_reboot
└─ src/lib.rs              # registrar comandos
scripts/download-adb.ps1   # + fastboot.exe
src/
├─ hooks/useBootloader.ts  # NOVO
├─ lib/ipc.ts              # + unlockBootloader, fastbootReboot
├─ types.ts                # + BootloaderResult
└─ components/DevicePanel.tsx  # + botão/confirmação/resultado bootloader
```

## Nota de Segurança/Legal

- Destina-se a aparelhos do próprio usuário ou com autorização do cliente.
- Confirmação explícita obrigatória; aviso de que o desbloqueio apaga dados.
- Compatibilidade real varia por aparelho/fabricante; o app cobre o caminho AOSP + fallback `oem unlock` com logs orientativos.

## Fora de Escopo (fase atual)

- Ferramentas de desbloqueio específicas por fabricante (ex: Xiaomi Mi Unlock, Samsung/Qualcomm).
- Desbloqueio de rede (SIM lock), reparo de IMEI/firmware via EDL/BROM.
- Bypass de verificações do fabricante.
