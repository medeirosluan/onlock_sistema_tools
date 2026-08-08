# OnLock Suite — Preparação de Revenda (Gerenciamento de Aparelhos) (Design)

Data: 2026-08-08

## Objetivo

Adicionar ao catálogo a operação de **preparação de aparelho para revenda**: verificar FRP status, listar/desativar/remover apps, e gerar uma ficha de saúde do aparelho. Reusando `AdbController` e o padrão já estabelecido, os novos botões entram no `OperationGrid` existente (abas Xiaomi/MTK). Tudo 100% legal (comandos adb públicos: getprop, pm).

## Decisões de abordagem

- A1 — Estender módulos existentes (comandos em `commands.rs`, botões no `OperationGrid`).
- Ações: Verificar FRP (log + banner), Apps (modal com lista + checkboxes → Desativar/Remover), Ficha de Saúde (cartão no painel).
- Sem novas dependências (reusa `AdbController::run_shell`/`getprop`).
- Preparação para revenda apenas (sem instalar apps, sem config avançada).

## Arquitetura

- **`commands.rs`** ganha 4 comandos (reusando `AdbController`):
  - `check_frp_status(serial) -> Result<FrpStatus, String>`:
    - `FrpStatus { frp_blocked: bool, oem_unlock_allowed: bool, message: String }` (Serialize).
    - Lê `getprop ro.frp.pst` (não vazio → frp_blocked) e `getprop sys.oem_unlock_allowed` (parse boolean). Log INFO/OK/ALERTA.
  - `list_apps(serial) -> Result<Vec<AppInfo>, String>`:
    - `AppInfo { package: String, system: bool, enabled: bool }` (Serialize).
    - `pm list packages -3` (usuário), `-s` (sistema), `-d` (desativados). Função pura `parse_apps(output) -> Vec<AppInfo>`.
  - `manage_apps(serial, packages: Vec<String>, action: String) -> Result<ManageAppsResult, String>`:
    - `ManageAppsResult { processed: usize, failed: Vec<String>, message: String }` (Serialize).
    - `action` ∈ "disable" (`pm disable-user`) | "uninstall" (`pm uninstall --user 0`).
  - `device_health(serial) -> Result<DeviceHealth, String>`:
    - `DeviceHealth { model, imei, android_version, build, total_storage, free_storage, battery, frp_blocked }` (String/String/String/String/String/String/u8/bool).
    - Reusa getprops existentes (modelo, IMEI, Android, build) + `df`/`df -h /data` para armazenamento + `dumpsys battery`.
- **Funções puras testáveis**:
  - `parse_apps(output: &str) -> Vec<AppInfo>` — combina saídas de `pm list packages -3`, `-s`, `-d`.
  - `parse_frp_pst(value: &str) -> bool` — vazio → false.
  - `parse_boolean(value: &str) -> bool` — "true"/"1" → true; "false"/"0" → false; vazio → false.
- **`lib.rs`**: registrar os 4 comandos.

## Frontend e UI

- **`OperationGrid` expandido** com 3 novos botões (acento por fabricante):
  - **Check FRP** → `checkFrpStatus(serial)` → banner (verde "FRP limpo" / âmbar "FRP presente") + log.
  - **Apps** → modal com lista de apps (`listApps(serial)`): checkboxes, botões "Desativar" e "Remover" nos selecionados (`manageApps`), resultado como log + banner.
  - **Ficha Saúde** → `deviceHealth(serial)` → cartão no painel (modelo, IMEI, Android, build, armazenamento total/livre, bateria, FRP).
- **`useResale` hook** (novo): `{ frpStatus, apps, health, loading, error, checkFrp, listApps, manageApps, getHealth }`.
- **`lib/ipc.ts`**: `checkFrpStatus(serial)`, `listApps(serial)`, `manageApps(serial, packages, action)`, `deviceHealth(serial)`.
- **`types.ts`**: `FrpStatus`, `AppInfo`, `ManageAppsResult`, `DeviceHealth`.

## Testes

- `cargo test`:
  - `parse_apps` — saída combinada de `pm list packages -3/-s/-d` → lista correta (system/enabled flags).
  - `parse_frp_pst` — vazio → false; não-vazio → true.
  - `parse_boolean` — "true"/"1" → true; "false"/"0" → false; vazio → false.
- Comandos reais não unit-tested (requerem aparelho).
- Testes existentes (27) permanecem.

## Configuração

- Sem novas dependências (reusa `AdbController::run_shell`/`getprop`).
- Nenhuma mudança em capabilities.

## Estrutura de Arquivos

```
src-tauri/src/
├─ commands.rs        # + check_frp_status, list_apps, manage_apps, device_health
└─ lib.rs             # registrar comandos
src/
├─ hooks/useResale.ts # NOVO
├─ lib/ipc.ts         # + 4 wrappers
├─ types.ts           # + FrpStatus, AppInfo, ManageAppsResult, DeviceHealth
└─ components/OperationGrid.tsx  # + 3 botões + modal apps + cartão saúde
```

## Fora de Escopo (fase atual)

- Instalar apps (apk), configuração avançada via adb, backup de apps.
- Exportar ficha de saúde como arquivo (cartão no painel nesta fase).
