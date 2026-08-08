# OnLock Suite — Esqueleto Tauri (Design)

Data: 2026-08-08

## Objetivo

Criar a estrutura inicial de um software desktop GSM estilo UnlockTool, em tema escuro, compilável e executável de ponta a ponta. Frontend em React + TypeScript + Tailwind CSS (Vite); backend em Rust com Tauri 2.x. O ADB é simulado no backend com comandos `#[tauri::command]` que leem informações de dispositivo e emitem logs em tempo real para o console da interface.

## Decisões de abordagem

- A1 — Scaffold oficial com `create-tauri-app` (template React+TS, Tauri 2.x) e customização posterior. Garante configuração oficial e projeto compilável/executável.
- Versão: Tauri 2.x.
- Idioma da interface: Português.
- Frontend: React + TypeScript + Tailwind CSS + Vite.
- Sem biblioteca de componentes (Tailwind puro é suficiente para o layout minimalista).

## Arquitetura

- **Backend Rust** em `src-tauri/`:
  - `main.rs` — entrypoint que chama `onlock_lib::run()`.
  - `lib.rs` — função `run()` que cria o builder do Tauri, registra o handler de comandos e gerencia o estado.
  - `commands.rs` — comandos `#[tauri::command]`.
  - `adb_simulator.rs` — módulo de simulação ADB, isolado e testável com `cargo test`.
- **Frontend React** em `src/`:
  - `components/TopBar.tsx` — barra superior.
  - `components/ManufacturerTabs.tsx` — abas por fabricante.
  - `components/DevicePanel.tsx` — conteúdo por aba (botão detectar + cartões de informação).
  - `components/LogConsole.tsx` — console de logs em tempo real.
  - `hooks/useLogs.ts` — hook que assina eventos `log-event`, `logs-cleared` e `adb-status`.
  - `lib/ipc.ts` — wrappers tipados para `invoke` e `listen`.
  - `types.ts` — tipos compartilhados do frontend.
  - `App.tsx`, `main.tsx`, `index.css` — composição e tokens de tema.
- **Comunicação**: comandos `invoke()` para chamadas sob demanda; eventos `emit` do Tauri para logs em tempo real.

## Layout e Interface

Layout em flexbox: header fixo no topo, abas, área central flex-1, console fixo no rodapé. Responsivo (área central encolhe em janelas pequenas; janela com `minWidth`/`minHeight`).

### TopBar
- Esquerda: nome do app "OnLock Suite" + versão (de `get_app_version`).
- Direita: indicador de status (ponto verde "Conectado" / cinza "Desconectado", via evento `adb-status`), avatar com inicial + nome de usuário "Operador", botão de refresh que re-dispara `detect_device`.

### Abas por fabricante
- Tabs horizontais: Samsung, Xiaomi, Qualcomm, MTK.
- Conteúdo da aba: cabeçalho com nome/plataforma, botão "Detectar dispositivo", grade de cartões com Modelo, Serial, Versão Android, Plataforma, Bateria, Estado.
- Abas inativas mostram "—" nos campos. O último resultado de detecção persiste por aba enquanto a sessão durar.

### Console de logs
- Linhas com timestamp, nível colorido e mensagem.
- Níveis: INFO (azul), OK (verde), WARN (âmbar), ERROR (vermelho).
- Auto-scroll para a última linha; botão "Limpar"; filtro por nível.
- Altura ~40% da janela, scroll interno.

### Tema escuro
- Fundo `#0f1115`, painéis `#171a21`, bordas `#262a33`, texto `#e6e8ec`.
- Acentos por fabricante: Samsung=azul, Xiaomi=laranja, Qualcomm=verde, MTK=roxo.
- Tokens de cor definidos via variáveis CSS no `index.css` (arquivo Tailwind configurado com `darkMode` e paleta).

## Backend Rust e Comandos

### Módulo `adb_simulator`
- `DeviceInfo` struct: `model`, `brand`, `serial`, `android_version`, `platform`, `connected`, `battery`, `imei`. Implementa `Serialize`/`Deserialize`.
- `AdbSimulator` (em `tauri::State`): gera dispositivo simulado por plataforma (samsung/mtk/qualcomm/xiaomi) com dados verossímeis (ex. Samsung SM-A546E, Android 13).
- Função `simulate_detect(platform) -> DeviceInfo`.

### Comandos
- `detect_device(app, platform)` → `DeviceInfo`: emite eventos de log em sequência ("Conectando ao dispositivo...", "Lendo propriedades via getprop...", "Dispositivo identificado"), aguarda ~400ms por etapa (sleep) e retorna o `DeviceInfo`. Retorna `connected: false` em caso de falha simulada, com log de erro.
- `clear_logs(app)` → notifica o frontend via evento `logs-cleared`.
- `get_app_version() -> String` — versão do app para a barra superior.

### Eventos
- `log-event` → `{ timestamp, level, message }`.
- `logs-cleared` → sem payload.
- `adb-status` → `{ connected, platform }`.

### Erros
- Comandos retornam `Result<T, String>`; falhas geram evento de log `ERROR` além de erro propagado ao `invoke()`.
- `lib.rs` registra um `LogEmitter` (state) com helper `emit_log(level, message)` reutilizado pelos comandos.

## Testes

- Testes unitários no `adb_simulator` via `cargo test`:
  - Geração de `DeviceInfo` por plataforma (dados esperados não vazios, `platform` correto).
  - Formato dos payloads de log (níveis válidos).
- Frontend: sem testes nesta fase inicial.

## Estrutura de Pastas

```
onlock_sistema_tools/
├─ src/                          # Frontend React
│  ├─ components/
│  │  ├─ TopBar.tsx
│  │  ├─ ManufacturerTabs.tsx
│  │  ├─ DevicePanel.tsx
│  │  └─ LogConsole.tsx
│  ├─ hooks/
│  │  └─ useLogs.ts
│  ├─ lib/
│  │  └─ ipc.ts
│  ├─ types.ts
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ index.css
├─ src-tauri/                    # Backend Rust
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ lib.rs
│  │  ├─ commands.rs
│  │  └─ adb_simulator.rs
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ index.html
├─ vite.config.ts
├─ tailwind.config.js
├─ package.json
└─ tsconfig.json
```

## Fora de Escopo (fase inicial)

- Comunicação ADB real (adb-server), operações de desbloqueio/flash, drivers.
- Autenticação de usuário real (status é fixo como "Operador").
- Persistência de dados, multi-idioma, testes de frontend, publicação/empacotamento.
