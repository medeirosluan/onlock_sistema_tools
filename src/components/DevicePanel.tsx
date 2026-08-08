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

export function DevicePanel({ platform, device, loading, error, mode, onDetect }: Props) {
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
    </section>
  );
}
