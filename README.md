# OnLock Suite

Software desktop GSM estilo UnlockTool — tema escuro. Esqueleto Tauri 2 + React + TypeScript + Tailwind CSS, com backend Rust simulando leitura ADB e logs em tempo real.

## Pré-requisitos

- Node.js 18+
- Rust (rustup)
- WebView2 (Windows, já presente na maioria dos sistemas)

## Executar em desenvolvimento

```
npm install
npm run tauri dev
```

## Testes

```
cd src-tauri
cargo test
```

## Comandos do backend

- `detect_device(platform)` — simula leitura ADB e retorna `DeviceInfo`; emite `log-event`/`adb-status`.
- `clear_logs()` — emite evento `logs-cleared`.
- `get_app_version()` — versão do app.
