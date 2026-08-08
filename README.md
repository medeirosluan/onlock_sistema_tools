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

## ADB real (sidecar)

O app usa o `adb` real (platform-tools) empacotado como sidecar. Para baixar o binário:

```
npm run download:adb
```

O `adb.exe` (e as DLLs) ficam em `src-tauri/binaries/` (fora do git). O app inicia o adb server automaticamente e lista os dispositivos conectados. Se o adb não estiver disponível, o app usa o modo simulação (badge "SIM" na interface).

Comandos novos:

- `list_devices()` — lista dispositivos via `adb devices -l`.
- `start_adb_server()` — inicia o adb server.
- `detect_device(serial, platform)` — lê propriedades reais (getprop) do dispositivo.
