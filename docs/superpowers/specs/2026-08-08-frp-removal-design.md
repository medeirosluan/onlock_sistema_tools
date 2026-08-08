# OnLock Suite — Operação Real de Remoção de FRP (Design)

Data: 2026-08-08

## Objetivo

Adicionar a primeira operação real de desbloqueio ao OnLock Suite: remoção de FRP (Factory Reset Protection) via comandos `adb shell` reais, em fluxo guiado por etapas com confirmação obrigatória, progresso em tempo real e opção de reiniciar/verificar o aparelho. A arquitetura é extensível para outras operações futuras (desbloqueio de bootloader, reparo, etc.).

## Decisões de abordagem

- A1 — Módulo dedicado `operations.rs` isolado e testável (padrão consistente com `adb_controller`/`adb_simulator`).
- Método: comandos `adb shell` reais (`settings`, `pm`) — viável em muitos aparelhos com USB debugging ativo, sem root.
- Abordagem de segurança: transparente e conservadora — o app mostra os comandos e exige confirmação explícita; sem técnicas de bypass ocultas nem EDL/BROM nesta fase.
- Fluxo guiado por etapas com reiniciar e verificar após sucesso.

## Arquitetura

- **Novo módulo Rust `operations.rs`**:
  - `FrpOperation` struct — representa operação em andamento (`serial`, `status`, `steps_done`, `total_steps`, `started_at`).
  - `FrpRemover` — executa a sequência de comandos FRP reais via `AdbController`; cada etapa emite evento de log INFO/OK/ERROR.
  - `FrpResult` — `{ serial: String, success: bool, steps_completed: usize, message: String }` (Serialize).
  - Função pura testável: `frp_steps() -> Vec<FrpStep>` (define a sequência e descrições pt-BR, sem executar adb).
- **`commands.rs`**: novos comandos:
  - `run_frp_removal(serial: String) -> Result<FrpResult, String>` — orquestra `FrpRemover` com logs por etapa.
  - `reboot_device(serial: String) -> Result<(), String>` — executa `adb reboot`.
- **`adb_controller.rs`**: sem mudanças estruturais — `FrpRemover` reusa `AdbController::getprop` e, se necessário, um `run_shell(serial, args)` exposto.

## Sequência de Comandos FRP (função `frp_steps()`)

5 etapas, cada uma com descrição pt-BR:

1. **Verificação** — `getprop ro.secure` + teste rápido de shell para confirmar USB debugging ativo (essencial).
2. **Provisionamento** — `adb shell settings put global device_provisioned 1` (essencial).
3. **Setup completo** — `adb shell settings put secure user_setup_complete 1` (essencial).
4. **Limpeza de contas** — `adb shell pm clear com.google.android.gms` (best-effort; falha não bloqueia, log WARN).
5. **Conclusão** — log OK "FRP removido — reinicie o aparelho" e `FrpResult { success: true }`.

- Etapas 1-3 são essenciais: falha em qualquer uma → log ERROR, `success: false`, operação para.
- Etapa 4 é best-effort: falha → log WARN e continua.

## Fluxo de Dados e IPC

- Frontend chama `run_frp_removal(serial)` (async); backend executa as etapas em sequência, emitindo `log-event` por etapa em tempo real.
- Retorna `FrpResult` com `success` e `steps_completed`.
- Após sucesso, frontend oferece "Reiniciar aparelho" → `reboot_device(serial)` → depois `list_devices`/`detect_device` para re-verificar.
- Erros de adb (sidecar/timeout) propagam `Err`; falha de etapa é logada e sinalizada no `FrpResult`.

## Confirmação (frontend)

- Antes de executar, o painel de Operações mostra: serial + modelo, aviso "Esta operação remove o bloqueio de conta (FRP) do aparelho", lista dos comandos que serão executados, botões "Confirmar" / "Cancelar".

## Frontend e UI

- **`DevicePanel.tsx`** — nova seção "Operações" visível quando `device.connected`:
  - Botão "Remover FRP".
  - Etapa de confirmação (modal): serial, modelo, aviso, lista de comandos, Confirmar/Cancelar.
  - Progresso em tempo real: etapas com estados (pendente → em andamento → OK/falha), alimentado por logs + estado do `FrpResult`.
  - Resultado: badge de sucesso/erro + mensagem; se sucesso, botão "Reiniciar aparelho".
- **`useFrp.ts`** (novo hook): encapsula `runFrpRemoval(serial)`, `rebootDevice(serial)`, estado `{ running, result, error, confirming }`.
- **`lib/ipc.ts`**: `runFrpRemoval(serial)`, `rebootDevice(serial)`.
- **`types.ts`**: `FrpResult { serial, success, steps_completed, message }`.
- `TopBar`/abas: sem mudanças.

## Testes

- `cargo test` em `operations.rs`:
  - `frp_steps()` retorna a sequência correta (5 etapas, descrições pt-BR).
  - Montagem de `FrpResult` (sucesso/falha).
- Comandos reais NÃO são testados unitariamente (exigem aparelho); a lógica de sequência/resultado é o testável.
- Testes existentes (14) permanecem.

## Configuração

- Sem novas dependências.
- Nenhuma mudança em `tauri.conf.json`/`capabilities` (tudo via comandos já registrados + sidecar).

## Estrutura de Arquivos

```
src-tauri/src/
├─ operations.rs        # NOVO — FrpRemover, FrpResult, FrpStep, frp_steps()
├─ commands.rs          # atualizado — run_frp_removal, reboot_device
└─ lib.rs               # atualizado — mod operations, registrar comandos
src/
├─ hooks/
│  └─ useFrp.ts         # NOVO
├─ lib/ipc.ts           # atualizado — runFrpRemoval, rebootDevice
├─ types.ts             # atualizado — FrpResult
└─ components/
   └─ DevicePanel.tsx   # atualizado — seção Operações + confirmação + progresso
```

## Nota de Segurança/Legal

- A operação destina-se a aparelhos do próprio usuário ou com autorização do cliente.
- O app exige confirmação explícita e mostra os comandos (transparência), conforme decisão do usuário.
- Sem técnicas de bypass ocultas, root ou EDL/BROM nesta fase.

## Fora de Escopo (fase atual)

- Desbloqueio de bootloader, desbloqueio de rede (SIM lock), reparo de IMEI/firmware via EDL/BROM.
- Técnicas de bypass via atividade oculta de setup ou acessibilidade.
- Operações por fabricante específicas (CSC/região, protocolos Exynos/MediaTek).
