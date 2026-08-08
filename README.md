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

- `detect_device(serial, platform)` — lê propriedades reais (getprop) do dispositivo; emite `log-event`/`adb-status`.
- `run_frp_removal(serial)` — executa a remoção de FRP (ver Operação abaixo).
- `reboot_device(serial)` — reinicia o aparelho via adb.
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

## Operação: Remoção de FRP

Com um aparelho conectado (modo REAL), a seção "Operações" do painel permite remover o bloqueio de conta (FRP):

1. Clique em **Remover FRP**.
2. Revise o aparelho e os comandos exibidos e clique em **Confirmar**.
3. Acompanhe o progresso no console de logs.
4. Ao final, clique em **Reiniciar aparelho** para aplicar.

Comandos executados:

- `getprop ro.secure`
- `settings put global device_provisioned 1`
- `settings put secure user_setup_complete 1`
- `pm clear com.google.android.gms`

### Limitação

Esta operação serve para **pular a tela de verificação de conta (FRP)** em um aparelho que está bloqueado após um factory reset, marcando-o como provisionado. Ela **não remove** a conta Google de um aparelho que já está em uso — remover a conta exige técnicas mais agressivas (root, apagar o banco de contas `accounts_de.db`) que ficam fora do escopo conservador desta fase. Em um aparelho já desbloqueado/provisionado, os comandos são inofensivos e a conta permanece (comportamento esperado).

## Operação: Desbloqueio de Bootloader (fastboot)

Com um aparelho conectado (modo REAL), a seção "Operações" do painel permite desbloquear o bootloader via fastboot:

1. Clique em **Desbloquear bootloader**.
2. Revise o aparelho e os comandos exibidos e clique em **Confirmar**.
3. Acompanhe o progresso no console de logs.
4. Ao final, clique em **Reiniciar aparelho** para aplicar.

Aviso: o desbloqueio apaga os dados do aparelho. Se o bootloader já estiver desbloqueado, o app informa e não executa.

Comandos executados:

- `fastboot getvar unlocked`
- `fastboot flashing unlock` (fallback: `fastboot oem unlock`)

### Limitação

Esta operação usa o **protocolo fastboot AOSP** e funciona em aparelhos que o expõem corretamente (ex: Pixel, OnePlus e a maioria dos aparelhos AOSP). **Não funciona em aparelhos Xiaomi/POCO com chipset MediaTek** (ex: POCO C31 / Redmi 9C, Helio G35):

- O bootloader desses aparelhos não expõe o gadget fastboot AOSP completo — nem o fastboot do Google, nem o da Xiaomi, nem o Mi Unlock oficial conseguem detectá-los via fastboot.
- O caminho oficial para Xiaomi/MediaTek é a ferramenta **Mi Unlock** da Xiaomi (conta + espera de 7 dias).
- O caminho alternativo é o **mtkclient** (modo BROM/preloader), que modifica a partição `seccfg` do chip — porém é de baixo nível, exige timing manual da entrada em BROM, e tem **risco real de brick**. Em vários aparelhos (incluindo o POCO C31) o preloader é protegido e o handshake falha, exigindo DA proprietário (ferramentas comerciais).

Antes de executar em um aparelho Xiaomi/MediaTek, verifique a compatibilidade. O app detecta e loga falhas do fastboot, mas a limitação é do fabricante.

## Operação: Backup / Restauração de Dados

Com um aparelho conectado (modo REAL), a seção "Operações" permite fazer backup dos dados do cliente antes de reparos:

1. Clique em **Backup / Restauração**.
2. Escolha as categorias (Fotos, Vídeos, Música, Downloads, Documentos, Contatos, SMS) e a pasta de destino no PC.
3. Acompanhe o progresso e, se necessário, clique em **Cancelar** (o que já foi copiado é preservado).

Limitações: contatos e SMS são salvos como dump de texto (não importável diretamente); restauração de SMS/contatos exige o app nativo do aparelho. Mídia é restaurada via push.
