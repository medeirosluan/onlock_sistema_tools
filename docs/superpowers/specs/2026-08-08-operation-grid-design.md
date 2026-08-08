# OnLock Suite — Grid de Operações Xiaomi/MTK + Format Userdata + Listener USB (Design)

Data: 2026-08-08

## Objetivo

Adicionar à área central um grid de 4 botões de operação (Read Info, Erase FRP, Reboot Fastboot, Format Userdata) visível nas abas Xiaomi e MTK, implementar o novo comando Format Userdata via fastboot, e adicionar um listener USB automático (polling) que atualiza o status do topo de "Nenhum dispositivo" para o serial/porta do aparelho conectado.

## Escopo (reuso vs novo)

Já existe e será REUSADO:
- **Read Info** → `detect_device` (adb real: modelo, IMEI, Android, plataforma).
- **Erase FRP** → `run_frp_removal` (com modal de confirmação existente).
- **Reboot Fastboot** → `reboot_bootloader` (backend) — precisa só do wrapper IPC no frontend.
- **Redirecionamento de logs** → `emit_log` → evento `log-event` → Console de Logs (timestamp + nível INFO/OK/WARN/ERROR, tempo real). Já funcional.

É NOVO:
- **Format Userdata** — comando `format_userdata` via fastboot.
- **Grid de botões** — componente `OperationGrid` por aba (mesmos 4 botões, acento por fabricante).
- **Listener USB** — polling de 3s no `useDevices` para atualizar status automaticamente.

## Decisões de abordagem

- A1 — Estender módulos existentes (mínimo código novo, reuso total).
- Format Userdata via fastboot (`fastboot erase userdata`), reusando `wait_for_fastboot_device` e `fastboot_long`.
- Mesmo grid nas abas Xiaomi e MTK (comandos genéricos/adb); cor de acento por fabricante.
- Listener via polling no frontend (3s), não thread backend.
- Confirmação obrigatória para operações destrutivas (Format Userdata apaga dados; Reboot Fastboot confirmação leve).

## Arquitetura

- **`commands.rs`**: novo `format_userdata(serial: String) -> Result<FormatResult, String>`:
  - `FormatResult { serial: String, success: bool, message: String }` (Serialize).
  - Função pura testável `format_result(serial, success, message) -> FormatResult`.
  - Sequência: `adb reboot bootloader` → `wait_for_fastboot_device(serial)` (30s) → `fastboot_long erase userdata` (60s) → `fastboot_reboot`.
  - Cada etapa emite `emit_log` INFO/OK/ERROR.
- **`lib.rs`**: registrar `format_userdata`.
- **Frontend**:
  - `OperationGrid.tsx` (novo) — grid de 4 botões com acento por fabricante.
  - `useDevices.ts` — polling de 3s (setInterval) chamando `refresh()`.
  - `lib/ipc.ts` — `rebootBootloader(serial)`, `formatUserdata(serial)`.
  - `types.ts` — `FormatResult`.
  - `DevicePanel.tsx` — renderizar `OperationGrid` quando a aba ativa é xiaomi/mtk.

## Grid de Botões

- **Read Info** → `detectDevice(serial, platform)` (existente).
- **Erase FRP** → `runFrpRemoval(serial)` (existente; abre modal de confirmação FRP).
- **Reboot Fastboot** → `rebootBootloader(serial)` (novo wrapper do `reboot_bootloader` existente; confirmação leve).
- **Format Userdata** → `formatUserdata(serial)` (novo; modal de confirmação "apaga dados").
- Acento por fabricante: Xiaomi → `accent-xiaomi` (laranja), MTK → `accent-mtk` (roxo), via tokens Tailwind existentes.
- Resultado/logs de cada operação → console (já funciona).

## Listener USB

- `useDevices` ganha polling: `setInterval(refresh, 3000)` no useEffect, com cleanup.
- Atualiza `devices` → `TopBar` mostra o serial/porta automaticamente (Nenhum dispositivo → conectado).
- Evita chamadas simultâneas (guarda `loading`).

## Testes

- `cargo test`:
  - `format_result()` montagem (sucesso/falha).
  - Sequência format_userdata não unit-tested (requer aparelho/fastboot) — padrão consistente.
- Testes existentes (25) permanecem.

## Configuração

- Sem novas dependências (reusa sidecar fastboot + helpers existentes).
- Nenhuma mudança em capabilities.

## Estrutura de Arquivos

```
src-tauri/src/
├─ commands.rs        # + format_userdata + format_result
└─ lib.rs             # registrar format_userdata
src/
├─ components/
│  └─ OperationGrid.tsx   # NOVO — 4 botões com acento por fabricante
├─ hooks/useDevices.ts    # + polling 3s
├─ lib/ipc.ts             # + rebootBootloader, formatUserdata
├─ types.ts               # + FormatResult
└─ components/DevicePanel.tsx  # + render OperationGrid quando aba xiaomi/mtk
```

## Fora de Escopo (fase atual)

- Operações específicas por fabricante (Xiaomi Mi Unlock, MTK BROM) — os 4 botões são genéricos/adb.
- Thread dedicada no backend para listener USB (polling no frontend é suficiente).
- Botões diferentes por fabricante.
