import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useFrp } from "../hooks/useFrp";
import { useBootloader } from "../hooks/useBootloader";
import { useBackup } from "../hooks/useBackup";
import type { ConnectionMode, DeviceInfo, Platform } from "../types";
import { OperationGrid } from "./OperationGrid";

interface Props {
  platform: Platform;
  device: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  mode: "real" | "sim";
  connectionMode: ConnectionMode;
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

export function DevicePanel({ platform, device, loading, error, mode, connectionMode: _connectionMode, onDetect }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bootConfirmOpen, setBootConfirmOpen] = useState(false);
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
    </section>
  );
}
