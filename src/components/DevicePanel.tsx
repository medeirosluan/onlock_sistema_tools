import { useState } from "react";
import { useFrp } from "../hooks/useFrp";
import type { DeviceInfo, Platform } from "../types";

interface Props {
  platform: Platform;
  device: DeviceInfo | null;
  loading: boolean;
  error: string | null;
  mode: "real" | "sim";
  onDetect: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  samsung: "Samsung",
  xiaomi: "Xiaomi",
  qualcomm: "Qualcomm",
  mtk: "MTK",
};

const FRP_COMMANDS = [
  "settings put global device_provisioned 1",
  "settings put secure user_setup_complete 1",
  "pm clear com.google.android.gms",
];

export function DevicePanel({ platform, device, loading, error, mode, onDetect }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { running, result, error: frpError, setConfirming, run, reboot } = useFrp();

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
    </section>
  );
}
