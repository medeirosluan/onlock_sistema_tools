# OnLock Suite — Detecção Multi-Modo de Conexão (ADB + Fastboot + MTP) (Design)

Data: 2026-08-08

## Objetivo

Permitir que o OnLock Suite detecte em qual modo o aparelho está conectado — **ADB**, **Fastboot** ou **MTP** — e adapte as operações disponíveis a cada modo. Isso resolve o cenário real de reparo onde o aparelho não tem ADB ativo (ex: Motorola em modo MTP), permitindo ao técnico identificar o modo, reiniciar em fastboot (via adb ou guia manual) e executar operações compatíveis (format userdata, reboot, getvar).

## Decisões de abordagem

- A1 — Comando consolidado `detect_connection_mode` que verifica ADB → Fastboot → MTP em uma única chamada.
- Detecção MTP via subprocess PowerShell `Get-PnpDevice -Class WPD` + parser testável (sem crate nova).
- Reuso do `reboot_bootloader_cmd` existente para "Reboot Fastboot" no modo MTP (tenta via adb; falha → guia manual).
- Modo exibido na TopBar (badge) + painel central adapta operações por modo.
- Polling de 3s integrado ao ciclo do `useDevices`.

## Arquitetura

- **`commands.rs`** ganha:
  - `ConnectionMode` enum: `Adb`, `Fastboot`, `Mtp`, `None` (derive `Debug`, `Clone`, `Serialize`, `Deserialize`, `PartialEq`).
  - `UsbDevice { vid: String, name: String }` (Debug, Clone, Serialize, PartialEq).
  - `ConnectionInfo { mode: ConnectionMode, device: Option<String>, serial: Option<String>, detail: String }` (Serialize).
  - `detect_connection_mode() -> Result<ConnectionInfo, String>`:
    1. `adb devices -l` → se `device` presente → `Adb` + serial.
    2. `fastboot devices` → se presente → `Fastboot` + serial.
    3. PowerShell `Get-PnpDevice -PresentOnly -Class WPD` → se aparelho móvel → `Mtp` + nome amigável.
  - Funções puras testáveis:
    - `classify_connection(adb_output: &str, fastboot_output: &str, usb_devices: &[UsbDevice]) -> ConnectionInfo` — prioridade ADB > Fastboot > MTP > None.
    - `parse_wpd_devices(output: &str) -> Vec<UsbDevice>` — extrai FriendlyName + VID de `Get-PnpDevice`.
    - `parse_fastboot_devices(output: &str) -> Vec<String>` — extrai serials de `fastboot devices`.
- **`lib.rs`**: registrar `detect_connection_mode`.

## Detecção por Modo

- **ADB:** `adb devices -l` (reusa `AdbController::list_devices`). Prioridade máxima.
- **Fastboot:** `fastboot devices` (reusa `run_fastboot`/`AdbController::fastboot` com `["devices"]`).
- **MTP:** subprocess `powershell Get-PnpDevice -PresentOnly -Class WPD` — parseia FriendlyName (ex: "motorola one macro") e VID do InstanceId (ex: `USB\VID_22B8...` → `22B8`). Um aparelho móvel é qualquer WPD com VID de fabricante conhecido de celular (lista de VIDs: 22B8=Motorola, 18D1=Google, 2717=Xiaomi, 04E8=Samsung, 0E8D=MediaTek, 12D1=Huawei, 05C6=Qualcomm, etc.) — ou, mais simples, qualquer WPD cujo nome não seja de dispositivo Windows típico (a lista de VIDs é mais robusta).
- Prioridade: ADB > Fastboot > MTP > None.

## Frontend e UI

- **`useConnectionMode` hook** (novo): `{ mode, device, serial, loading, error, refresh }` — polling de 3s chamando `detectConnectionMode`, integrado ao ciclo do `useDevices`.
- **TopBar:** badge de modo ao lado do status — "ADB" (verde), "Fastboot" (azul), "MTP" (âmbar) — + nome do aparelho (ex: "ADB · Motorola one macro").
- **DevicePanel adapta por modo:**
  - **ADB:** painel atual (detectar, operações, grid Xiaomi/MTK).
  - **Fastboot:** painel simplificado com "Format Userdata", "Reboot", "Detectar estado (getvar unlocked)" — reusa `format_userdata`, `fastboot_reboot`, `unlock_bootloader`.
  - **MTP:** mensagem "Aparelho em modo MTP" + botão "Reboot Fastboot" (tenta via adb `rebootBootloader(serial)`; se falhar, modal com guia manual: desligar → Vol Down + Power → soltar ao ver fastboot).
  - **None:** placeholder atual.
- **`lib/ipc.ts`**: `detectConnectionMode(): Promise<ConnectionInfo>`.
- **`types.ts`**: `ConnectionMode`, `ConnectionInfo`.

## Testes

- `cargo test`:
  - `classify_connection` — prioridade ADB > Fastboot > MTP > None (vários cenários).
  - `parse_wpd_devices` — saída real de `Get-PnpDevice -Class WPD` → lista de UsbDevice (nome + vid).
  - `parse_fastboot_devices` — saída de `fastboot devices` → serials.
- Comandos reais não unit-tested (requerem aparelho).
- Testes existentes (32) permanecem.

## Configuração

- Sem novas dependências Rust (subprocess PowerShell para MTP).
- Nenhuma mudança em capabilities.

## Estrutura de Arquivos

```
src-tauri/src/
├─ commands.rs        # + detect_connection_mode, ConnectionMode, ConnectionInfo, UsbDevice, classify_connection, parse_wpd_devices, parse_fastboot_devices
└─ lib.rs             # registrar detect_connection_mode
src/
├─ hooks/useConnectionMode.ts  # NOVO
├─ lib/ipc.ts         # + detectConnectionMode
├─ types.ts           # + ConnectionMode, ConnectionInfo
├─ components/TopBar.tsx      # + badge de modo
└─ components/DevicePanel.tsx # + adaptação por modo + guia manual MTP
```

## Fora de Escopo (fase atual)

- EDL (Qualcomm) e BROM (MediaTek).
- Backup de dados via MTP.
- Operações de flash (boot/recovery).
- Lista completa de VIDs de fabricantes (lista básica de celulares nesta fase).
