# OnLock Suite — Integração ADB Real (Design)

Data: 2026-08-08

## Objetivo

Substituir a simulação de leitura ADB por integração real com o adb server (platform-tools do Android), empacotado como sidecar do Tauri. O app inicia o adb server automaticamente, lista dispositivos conectados e lê informações reais via `getprop`/`dumpsys battery`, atualizando o painel e os logs em tempo real. A simulação permanece como fallback offline ("modo demo") quando o adb não está disponível.

## Decisões de abordagem

- A1 — tauri-plugin-shell com sidecar (`externalBin`): o `Command::new_sidecar("adb")` resolve o binário por plataforma automaticamente. Oficial e idiomático no Tauri 2, pronto para multi-plataforma.
- Binário obtido por script de download do Google (platform-tools). Fase atual: Windows somente (`adb.exe`); estrutura pronta para macos/linux.
- Início automático do adb server no lançamento (idempotente).
- Seletor de dispositivos na UI quando houver 2+ conectados.
- Detecção completa: lista + getprop + bateria.

## Arquitetura

- **Novo módulo Rust `adb_controller.rs`**, isolado e testável:
  - `AdbController` — resolve o sidecar via shell plugin; expõe `start_server()`, `list_devices()`, `getprop(serial, key)`, `detect(serial)`.
  - Modelos: `AdbDevice { serial: String, state: String, model: Option<String> }`.
  - Parsing puro e testável: `parse_devices(adb_output) -> Vec<AdbDevice>`, `parse_getprop(output) -> Option<String>`, `map_platform(brand, board_platform) -> Platform`, `parse_battery_level(output) -> Option<u8>`.
- **`commands.rs`** atualizado:
  - `detect_device(serial: String) -> Result<DeviceInfo, String>` — detecção real via getprop, logs INFO em tempo real, `adb-status` emitido.
  - `list_devices() -> Vec<AdbDevice>` — para o seletor.
  - `start_adb_server() -> Result<(), String>` — chamado no lançamento; se falhar, log WARN e fallback para simulação.
  - `clear_logs`, `get_app_version` — inalterados.
- **`adb_simulator.rs`** — mantido como fallback/offline. Se o adb não estiver disponível, `detect_device` cai para simulação com log WARN.
- **Frontend**: novo `DeviceSelector`, hook `useDevices`, `DevicePanel`/`TopBar` atualizados.

## Fluxo de Dados e IPC

### Lançamento
1. Frontend chama `start_adb_server` (idempotente).
2. Backend resolve sidecar via `Command::new_sidecar("adb")` e executa `adb start-server`.
3. Logs: "Iniciando adb server..." → "ADB server iniciado" / "Erro ao iniciar adb server" + fallback WARN para simulação.

### Detecção
1. `list_devices()` → `adb devices -l` → `Vec<AdbDevice>`.
2. 0 dispositivos: log ERROR "Nenhum dispositivo encontrado", status desconectado.
3. 1 dispositivo: usa direto. 2+: frontend abre o `DeviceSelector`.
4. `detect_device(serial)` executa em sequência, com log INFO por etapa:
   - `ro.product.model` → modelo
   - `ro.product.brand` → marca
   - `ro.build.version.release` → versão Android
   - `ro.serialno` (fallback: serial da listagem) → serial
   - `ro.board.platform` + marca → plataforma (samsung/xiaomi/qualcomm/mtk)
   - `dumpsys battery` → nível de bateria (parse `level: N`)
5. Monta `DeviceInfo` real, emite `adb-status` conectado + log OK "Dispositivo identificado".

### Eventos
- Inalterados: `log-event`, `logs-cleared`, `adb-status`, agora alimentados por dados reais.

### Erros
- Falha em qualquer `getprop` → log ERROR e `Err` propagado; UI mantém estado anterior.
- Sem adb disponível → log WARN "ADB não encontrado — usando modo simulação"; `detect_device` usa `simulate_detect(platform)`.

## Frontend e UI

- **`DeviceSelector.tsx`** (novo): modal que lista serial + modelo de cada dispositivo quando há 2+. Clique escolhe; cancelar mantém o estado.
- **`DevicePanel.tsx`** (atualizado): botão "Detectar dispositivo" dispara detecção real; abre o seletor se houver 2+ dispositivos. Painel de cartões inalterado (dados reais agora). Estado "sem adb" mostra aviso "ADB não encontrado — usando modo simulação".
- **`useDevices.ts`** (novo): chama `list_devices`, gerencia `{ devices: AdbDevice[], loading, error }`.
- **`TopBar.tsx`** (atualizado): contador de dispositivos ("2 dispositivos") e badge de modo REAL/SIM.
- **Abas**: a aba ativa indica a plataforma esperada, mas `DeviceInfo.platform` real é o que vale para exibição. Detecção funciona em qualquer aba (o serial manda).

## Testes

- `cargo test` em `adb_controller`:
  - `parse_devices` com saída de exemplo de `adb devices -l` → lista correta.
  - `parse_getprop` com saída de exemplo → valor correto.
  - `map_platform`: `ro.board.platform` `mt6768` → mtk; marca "Xiaomi" → xiaomi; `sm8550` → qualcomm; marca "Samsung" → samsung; desconhecido → fallback.
  - `parse_battery_level`: `  level: 84` → Some(84); ausente → None.
- `adb_simulator`: testes existentes permanecem.
- Frontend: sem testes (mesma política do esqueleto).

## Configuração

- `tauri.conf.json`: `bundle.externalBin: ["binaries/adb"]`.
- `capabilities/default.json`: permissão `shell:allow-execute` com escopo no sidecar adb.
- `Cargo.toml`: adicionar `tauri-plugin-shell = "2"`.
- `scripts/download-adb.ps1` (novo): baixa `platform-tools-latest-windows.zip` do Google, extrai `adb.exe` (e dependências: `AdbWinApi.dll`, `AdbWinUsbApi.dll`) para `src-tauri/binaries/`. Script `npm run download:adb` no package.json.
- `.gitignore`: adicionar `src-tauri/binaries/` (binário fora do git).

## Estrutura de Arquivos

```
src-tauri/src/
├─ adb_controller.rs      # NOVO
├─ commands.rs            # atualizado
├─ adb_simulator.rs       # mantido (fallback)
src/
├─ components/
│  ├─ DeviceSelector.tsx  # NOVO
│  ├─ DevicePanel.tsx     # atualizado
│  └─ TopBar.tsx          # atualizado (contador + badge)
├─ hooks/
│  └─ useDevices.ts       # NOVO
└─ lib/ipc.ts             # atualizado (list_devices, start_adb_server, detect serial)
scripts/
└─ download-adb.ps1       # NOVO
```

## Fora de Escopo (fase atual)

- Binários multi-plataforma (macos/linux) — apenas estrutura preparada; download só Windows.
- Operações de desbloqueio/flash, envio de firmware, escrita de IMEI.
- Polling contínuo de dispositivos (detecção é sob demanda pelo botão/refresh).
- Autenticação real de usuário.
