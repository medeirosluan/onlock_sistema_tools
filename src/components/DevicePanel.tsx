import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useFrp } from "../hooks/useFrp";
import { useBootloader } from "../hooks/useBootloader";
import { useBackup } from "../hooks/useBackup";
import { useFlash } from "../hooks/useFlash";
import { fastbootGetvar, formatUserdata, fastbootReboot, rebootBootloader } from "../lib/ipc";
import type { ConnectionMode, DeviceInfo, Platform } from "../types";
import { OperationGrid } from "./OperationGrid";

interface Props {
  platform: Platform;
  device: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  mode: "real" | "sim";
  connectionMode: ConnectionMode;
  connectionSerial: string | null;
  onDetect: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  samsung: "Samsung",
  xiaomi: "Xiaomi",
  qualcomm: "Qualcomm",
  mtk: "MTK",
};

const FRP_COMMANDS = [
  "getprop ro.secure",
  "settings put global device_provisioned 1",
  "settings put secure user_setup_complete 1",
  "pm clear com.google.android.gms",
];

const BOOTLOADER_COMMANDS = [
  "fastboot getvar unlocked",
  "fastboot flashing unlock",
  "fastboot oem unlock",
];

export function DevicePanel({ platform, device, loading, error, mode, connectionMode, connectionSerial, onDetect }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bootConfirmOpen, setBootConfirmOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [mtpGuideOpen, setMtpGuideOpen] = useState(false);
  const [fastbootDetecting, setFastbootDetecting] = useState(false);
  const { running, result, error: frpError, setConfirming, run, reboot } = useFrp();
  const {
    running: bootRunning,
    result: bootResult,
    error: bootError,
    setConfirming: setBootConfirming,
    run: bootRun,
    reboot: bootReboot,
  } = useBootloader();
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupTab, setBackupTab] = useState<"backup" | "restore">("backup");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [backupDestination, setBackupDestination] = useState<string>("");
  const {
    categories,
    running: backupRunning,
    progress,
    result: backupResult,
    error: backupError,
    run: runBackup,
    restore,
    cancel,
  } = useBackup();
  const [flashOpen, setFlashOpen] = useState(false);
  const [flashUrl, setFlashUrl] = useState("");
  const [flashPartition, setFlashPartition] = useState("");
  const [flashConfirmOpen, setFlashConfirmOpen] = useState(false);
  const { running: flashRunning, progress: flashProgress, result: flashResult, error: flashError, run: flashRun } = useFlash();

  const pickFolder = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") setBackupDestination(dir);
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const fields = device
    ? [
        ["Modelo", device.model],
        ["Marca", device.brand],
        ["Serial", device.serial],
        ["Versão Android", device.android_version],
        ["Plataforma", device.platform],
        ["Bateria", device.connected ? `${device.battery}%` : "—"],
        ["IMEI", device.imei],
      ]
    : [];

  const handleConfirm = () => {
    setConfirmOpen(false);
    setConfirming(true);
    run(device!.serial);
  };

  const handleBootConfirm = () => {
    setBootConfirmOpen(false);
    setBootConfirming(true);
    bootRun(device!.serial);
  };

  const handleEraseFrp = () => {
    setConfirmOpen(true);
  };

  const handleMtpReboot = async () => {
    if (!connectionSerial) {
      setMtpGuideOpen(true);
      return;
    }
    try {
      await rebootBootloader(connectionSerial);
    } catch {
      setMtpGuideOpen(true);
    }
  };

  const handleFastbootGetvar = async () => {
    if (!connectionSerial) return;
    setFastbootDetecting(true);
    try {
      const result = await fastbootGetvar(connectionSerial, "unlocked");
      // resultado vai para o console de logs via backend; sem banner nesta fase
      void result;
    } catch {
      // erro já logado pelo backend
    } finally {
      setFastbootDetecting(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-fg">{PLATFORM_LABELS[platform]}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              mode === "real" ? "bg-log-ok text-black" : "bg-log-warn text-black"
            }`}
          >
            {mode === "real" ? "Real" : "Sim"}
          </span>
        </div>
        <button
          onClick={onDetect}
          disabled={loading}
          className="rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border disabled:opacity-50"
        >
          {loading ? "Detectando..." : "Detectar dispositivo"}
        </button>
      </div>

      {(platform === "xiaomi" || platform === "mtk") && device?.connected && (
        <OperationGrid
          platform={platform}
          serial={device.serial}
          onReadInfo={onDetect}
          onEraseFrp={handleEraseFrp}
        />
      )}

      {error && (
        <div className="rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
          {error}
        </div>
      )}

      {mode === "sim" && !device && (
        <p className="text-xs text-muted">
          ADB não encontrado — usando modo simulação. Rode <code className="text-fg">npm run download:adb</code> e reinicie.
        </p>
      )}

      {connectionMode === "Fastboot" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            onClick={() => setFormatOpen(true)}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Format Userdata
          </button>
          <button
            onClick={() => fastbootReboot(connectionSerial ?? "")}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Reboot
          </button>
          <button
            onClick={handleFastbootGetvar}
            disabled={fastbootDetecting}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border disabled:opacity-50"
          >
            {fastbootDetecting ? "Verificando..." : "Detectar estado"}
          </button>
          <button
            onClick={() => setFlashOpen(true)}
            className="rounded border border-border bg-panel p-4 text-sm text-fg hover:bg-border"
          >
            Flash Firmware
          </button>
        </div>
      )}

      {connectionMode === "Mtp" && (
        <div className="rounded border border-border bg-panel p-4">
          <h3 className="text-sm font-semibold text-fg">Aparelho em modo MTP</h3>
          <p className="mt-1 text-xs text-muted">
            A Depuração USB está desativada. Ative-a nas Opções de Desenvolvedor para operações avançadas,
            ou reinicie em modo fastboot.
          </p>
          <button
            onClick={handleMtpReboot}
            className="mt-3 rounded border border-border px-4 py-2 text-sm text-fg hover:bg-border"
          >
            Reboot Fastboot
          </button>
        </div>
      )}

      {device?.connected ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded border border-border bg-panel p-3">
              <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
              <p className="mt-1 truncate text-sm text-fg">{value || "—"}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-border">
          <p className="px-4 text-center text-sm text-muted">
            {loading
              ? "Detectando dispositivo..."
              : 'Nenhum dispositivo detectado. Clique em "Detectar dispositivo".'}
          </p>
        </div>
      )}

      {device?.connected && (
        <div className="rounded border border-border bg-panel p-4">
          <h3 className="text-sm font-semibold text-fg">Operações</h3>
          <p className="mt-1 text-xs text-muted">
            Remova o bloqueio de conta (FRP) do aparelho conectado.
          </p>

          {frpError && (
            <div className="mt-3 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
              {frpError}
            </div>
          )}

          {result?.success ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-log-ok">FRP removido — reinicie o aparelho.</p>
              <button
                onClick={() => reboot(device.serial)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Reiniciar aparelho
              </button>
            </div>
          ) : (
            !running && (
              <button
                onClick={() => setConfirmOpen(true)}
                className="mt-3 rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border"
              >
                Remover FRP
              </button>
            )
          )}

          {running && (
            <p className="mt-3 text-sm text-muted">Executando remoção de FRP... Acompanhe o console de logs.</p>
          )}

          {bootError && (
            <div className="mt-3 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
              {bootError}
            </div>
          )}

          {bootResult?.success ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-log-ok">
                {bootResult.message || "Bootloader desbloqueado — reinicie o aparelho."}
              </p>
              <button
                onClick={() => bootReboot(device.serial)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Reiniciar aparelho
              </button>
            </div>
          ) : (
            !bootRunning && (
              <button
                onClick={() => setBootConfirmOpen(true)}
                className="mt-3 rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border"
              >
                Desbloquear bootloader
              </button>
            )
          )}

          {bootRunning && (
            <p className="mt-3 text-sm text-muted">Executando desbloqueio do bootloader... Acompanhe o console de logs.</p>
          )}

          <button
            onClick={() => setBackupOpen(true)}
            className="mt-3 rounded border border-border bg-panel px-4 py-2 text-sm text-fg hover:bg-border"
          >
            Backup / Restauração
          </button>
        </div>
      )}

      {confirmOpen && device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar remoção de FRP</h3>
            <p className="mt-2 text-xs text-muted">
              Dispositivo: <span className="font-mono text-fg">{device.serial}</span>
              {device.model ? ` (${device.model})` : ""}
            </p>
            <p className="mt-2 text-sm text-log-warn">
              Esta operação remove o bloqueio de conta (FRP) do aparelho.
            </p>
            <p className="mt-2 text-xs text-muted">Comandos a executar:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {FRP_COMMANDS.map((cmd) => (
                <li key={cmd} className="font-mono text-xs text-fg">
                  $ {cmd}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {bootConfirmOpen && device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar desbloqueio do bootloader</h3>
            <p className="mt-2 text-xs text-muted">
              Dispositivo: <span className="font-mono text-fg">{device.serial}</span>
              {device.model ? ` (${device.model})` : ""}
            </p>
            <p className="mt-2 text-sm text-log-warn">
              Esta operação desbloqueia o bootloader e apaga os dados do aparelho.
            </p>
            <p className="mt-2 text-xs text-muted">Comandos a executar:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {BOOTLOADER_COMMANDS.map((cmd) => (
                <li key={cmd} className="font-mono text-xs text-fg">
                  $ {cmd}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBootConfirmOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleBootConfirm}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {formatOpen && connectionSerial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar formatação do userdata</h3>
            <p className="mt-2 text-sm text-muted">
              Dispositivo: <span className="font-mono text-fg">{connectionSerial}</span>
            </p>
            <p className="mt-2 text-sm text-log-warn">
              Esta operação apaga todos os dados do usuário do aparelho.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFormatOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setFormatOpen(false);
                  formatUserdata(connectionSerial);
                }}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {backupOpen && device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Backup / Restauração</h3>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setBackupTab("backup")}
                className={`flex-1 rounded border px-3 py-1.5 text-sm ${
                  backupTab === "backup"
                    ? "border-accent-samsung bg-accent-samsung text-black"
                    : "border-border text-fg hover:bg-border"
                }`}
              >
                Backup
              </button>
              <button
                onClick={() => setBackupTab("restore")}
                className={`flex-1 rounded border px-3 py-1.5 text-sm ${
                  backupTab === "restore"
                    ? "border-accent-samsung bg-accent-samsung text-black"
                    : "border-border text-fg hover:bg-border"
                }`}
              >
                Restauração
              </button>
            </div>

            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Categorias</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {categories.map((cat) => (
                <label key={cat.id} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    disabled={backupRunning}
                    className="accent-accent-samsung"
                  />
                  {cat.label}
                </label>
              ))}
            </div>

            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Destino</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={pickFolder}
                disabled={backupRunning}
                className="rounded border border-border bg-panel px-3 py-1.5 text-sm text-fg hover:bg-border disabled:opacity-50"
              >
                Escolher pasta
              </button>
              <p className="min-w-0 flex-1 truncate text-xs text-muted">
                {backupDestination || "Nenhuma pasta selecionada"}
              </p>
            </div>

            {backupError && (
              <div className="mt-3 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
                {backupError}
              </div>
            )}

            {backupRunning ? (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded bg-border">
                  <div
                    className="h-full rounded bg-accent-samsung transition-all"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-fg">
                  {progress ? `Copiando ${progress.file}` : "Preparando..."}
                </p>
                {progress && (
                  <p className="mt-1 text-xs text-muted">
                    arquivo {progress.files_done} de {progress.total_files}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={cancel}
                    className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              backupResult && (
                <div className="mt-4 rounded border border-log-ok/40 bg-log-ok/10 px-3 py-2 text-sm text-log-ok">
                  <p>Categorias: {backupResult.categories_done.join(", ")}</p>
                  <p>Arquivos: {backupResult.files_copied}</p>
                  <p className="truncate">Destino: {backupResult.destination}</p>
                </div>
              )
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBackupOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
              {!backupRunning && (
                <button
                  disabled={!backupDestination || selectedCategories.length === 0}
                  onClick={() =>
                    backupTab === "backup"
                      ? runBackup(device.serial, selectedCategories as any, backupDestination)
                      : restore(device.serial, backupDestination, selectedCategories as any)
                  }
                  className="rounded bg-accent-samsung px-3 py-1.5 text-sm text-black hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {backupTab === "backup" ? "Iniciar backup" : "Restaurar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {flashOpen && connectionSerial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Flash de Firmware</h3>
            <p className="mt-2 text-xs text-muted">
              Dispositivo: <span className="font-mono text-fg">{connectionSerial}</span>
              {device?.model ? ` (${device.model})` : ""}
            </p>
            <label className="mt-3 block text-xs text-muted">URL da ROM</label>
            <input
              value={flashUrl}
              onChange={(e) => setFlashUrl(e.target.value)}
              placeholder="https://.../rom.zip"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <label className="mt-3 block text-xs text-muted">
              Partição (opcional — detectada do arquivo se vazio)
            </label>
            <input
              value={flashPartition}
              onChange={(e) => setFlashPartition(e.target.value)}
              placeholder="ex: boot, recovery, vbmeta"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            {flashError && (
              <div className="mt-2 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
                {flashError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFlashOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={() => setFlashConfirmOpen(true)}
                disabled={!flashUrl || flashRunning}
                className="rounded bg-accent-samsung px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {flashConfirmOpen && connectionSerial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar Flash</h3>
            <p className="mt-2 text-sm text-log-warn">
              O flash pode danificar o aparelho se a ROM for incompatível com{" "}
              <strong>{device?.model || connectionSerial}</strong>.
            </p>
            <p className="mt-2 text-xs text-muted">Firmware: <span className="font-mono text-fg">{flashUrl}</span></p>
            <p className="mt-1 text-xs text-muted">
              Partição: <span className="font-mono text-fg">{flashPartition || "auto (do arquivo)"}</span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFlashConfirmOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  setFlashConfirmOpen(false);
                  setFlashOpen(false);
                  flashRun(connectionSerial, flashUrl, flashPartition || undefined);
                }}
                disabled={flashRunning}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50"
              >
                Confirmar Flash
              </button>
            </div>
          </div>
        </div>
      )}

      {flashRunning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Flashando...</h3>
            <div className="mt-3 h-2 w-full overflow-hidden rounded bg-border">
              <div
                className="h-full bg-accent-samsung transition-all"
                style={{ width: `${flashProgress?.percent ?? 0}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-fg">{flashProgress?.message ?? "Preparando..."}</p>
          </div>
        </div>
      )}

      {flashResult && !flashRunning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">
              {flashResult.success ? "Flash concluído" : "Falha no flash"}
            </h3>
            <p className={`mt-2 text-sm ${flashResult.success ? "text-log-ok" : "text-log-error"}`}>
              {flashResult.message}
            </p>
            {flashResult.success && (
              <button
                onClick={() => fastbootReboot(connectionSerial ?? "")}
                className="mt-4 rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Reiniciar
              </button>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setFlashOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {mtpGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Entrar em modo fastboot manualmente</h3>
            <p className="mt-2 text-sm text-muted">Siga os passos no aparelho:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg">
              <li>Desligue o aparelho completamente.</li>
              <li>Mantenha pressionado <strong>Volume Down + Power</strong> juntos.</li>
              <li>Solte quando aparecer a tela de fastboot (robô deitado).</li>
              <li>Conecte o cabo USB novamente.</li>
            </ol>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setMtpGuideOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
