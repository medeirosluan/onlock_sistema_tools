# OnLock Suite — Flash de Firmware com Download Automático (Design)

Data: 2026-08-08

## Objetivo

Adicionar ao OnLock Suite a operação de **flash de firmware** via fastboot, com **download automático da ROM**: o técnico identifica o aparelho (modelo pré-preenchido pelo app), fornece a URL da ROM (de uma fonte confiável), o app baixa, extrai (se ZIP), identifica as partições e flasha via fastboot com progresso, confirmação dupla e opção de reiniciar. 100% legal (fastboot público + download HTTP).

## Decisões de abordagem

- A1 — Módulo dedicado `flashing.rs` (padrão `operations.rs`/`backup.rs`).
- Download via `reqwest`, extração via `zip`, flash via `fastboot` (sidecar existente).
- URL fornecida pelo técnico + modelo pré-preenchido (sem API externa de firmware).
- Formatos suportados: `.img` individual e ZIP de ROM (descompactado e flashado por partição).
- Confirmação dupla (aviso de incompatibilidade + lista de partições).
- Parar na primeira falha de flash (evita brick).
- Sem cancelamento nesta fase (flash é rápido e já confirmado).
- Pós-flash: "Reiniciar" + log OK/ERRO por partição.

## Arquitetura

- **Novo módulo Rust `flashing.rs`**:
  - `FlashResult { serial: String, partition: String, file: String, success: bool, message: String }` (Serialize).
  - `FlashProgress { phase: String, message: String, percent: u8 }` (Serialize) — emitido via evento `flash-progress`.
  - `detect_partition_from_filename(filename: &str) -> Option<String>` — função pura testável (boot/recovery/vbmeta/system/etc. do nome).
  - `flash_from_url(app, serial, url, partition: Option<String>) -> Result<FlashResult, String>`:
    1. Baixa via `reqwest` para `temp/flash_<serial>/` com progresso por fase.
    2. Se `.zip` → extrai com `zip`; detecta partição por nome do arquivo (ou usa `partition` fornecido).
    3. Se `.img` → usa direto (partição fornecida ou inferida do nome).
    4. `fastboot flash <particao> <arquivo>` com timeout 300s.
    5. Para na primeira falha. Limpa o temp ao final.
- **`adb_controller.rs`**: `fastboot_flash(app, serial, partition, local_path)` — `fastboot -s serial flash <partition> <path>`, timeout 300s.
- **`commands.rs`**: `flash_firmware(app, serial, url, partition: Option<String>) -> Result<FlashResult, String>`.
- **`lib.rs`**: registrar `flash_firmware`.

## Fluxo de Dados

1. Frontend chama `flash_firmware(serial, url, partition)`.
2. Backend valida serial + URL.
3. Baixa para `temp/flash_<serial>/` com `flash-progress` (fase "baixando", percent por bytes).
4. Extrai ZIP (se aplicável), identifica partições.
5. Para cada partição: `fastboot flash` com log OK/ERRO; para na primeira falha.
6. `FlashResult` + botão "Reiniciar" (`fastboot_reboot` existente).
7. Limpa o temp.

## Frontend e UI

- **Painel Fastboot**: botão **"Flash Firmware"** ao lado de Format Userdata / Reboot / Detectar estado.
- **Modal Flash**:
  - Modelo pré-preenchido (de `device.model` se ADB, ou `connectionDevice`/serial se fastboot).
  - Campo de URL.
  - Campo opcional de partição (se vazio, detecta do nome).
  - **Confirmação dupla**: (1) aviso "Flash pode danificar o aparelho se a ROM for incompatível com <modelo>", (2) lista das partições a gravar (após download) + botão "Confirmar Flash".
  - Progresso: barra + fase via `flash-progress`.
  - Resultado: sucesso/erro + "Reiniciar".
- **`useFlash` hook** (novo): `{ running, progress, result, error, run }` — assina `flash-progress`.
- **`lib/ipc.ts`**: `flashFirmware(serial, url, partition)`, `onFlashProgress(cb)`.
- **`types.ts`**: `FlashProgress`, `FlashResult`.

## Testes

- `cargo test`:
  - `detect_partition_from_filename` — "boot.img"→boot; "recovery.img"→recovery; "vbmeta.img"→vbmeta; "system.img"→system; nome desconhecido→None.
  - `FlashResult` montagem (sucesso/falha).
- Download/extração/flash reais não unit-tested (requerem rede/aparelho); extração ZIP pode ser testada com fixture local (opcional).
- Testes existentes (39) permanecem.

## Configuração

- `Cargo.toml`: `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }`, `zip = "2"`, `futures-util` (se necessário para streaming).
- Temp de download em `std::env::temp_dir()` — fora do repo.

## Estrutura de Arquivos

```
src-tauri/src/
├─ flashing.rs          # NOVO — FlashResult, FlashProgress, detect_partition_from_filename, flash_from_url
├─ adb_controller.rs    # + fastboot_flash (300s)
├─ commands.rs          # + flash_firmware
└─ lib.rs               # registrar flash_firmware
src/
├─ hooks/useFlash.ts    # NOVO
├─ lib/ipc.ts           # + flashFirmware, onFlashProgress
├─ types.ts             # + FlashProgress, FlashResult
└─ components/DevicePanel.tsx  # + botão Flash Firmware + modal
```

## Fora de Escopo (fase atual)

- API externa de firmware (firmware.mobi etc.) — URL fornecida pelo técnico.
- Flash de ROM em aparelhos que não expõem fastboot AOSP (Xiaomi/MediaTek — já documentado como limitação).
- Cancelamento durante download/flash.
- Verificação de compatibilidade ROM×modelo automática (confirmação manual).
