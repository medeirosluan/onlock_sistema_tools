import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/ipc";
import type { ConnectionMode } from "../types";

interface Props {
  deviceCount: number;
  mode: ConnectionMode;
  deviceName: string | null;
  onRefresh: () => void;
}

const MODE_STYLE: Record<ConnectionMode, string> = {
  Adb: "bg-log-ok text-black",
  Fastboot: "bg-accent-samsung text-white",
  Mtp: "bg-log-warn text-black",
  None: "bg-border text-muted",
};

const MODE_LABEL: Record<ConnectionMode, string> = {
  Adb: "ADB",
  Fastboot: "Fastboot",
  Mtp: "MTP",
  None: "",
};

export function TopBar({ deviceCount, mode, deviceName, onRefresh }: Props) {
  const [version, setVersion] = useState("0.1.0");
  const connected = mode !== "None";

  useEffect(() => {
    getAppVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-panel px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent-samsung font-bold text-white">
          O
        </span>
        <div>
          <h1 className="text-base font-semibold leading-tight text-fg">OnLock Suite</h1>
          <p className="text-xs text-muted">v{version}</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-log-ok" : "bg-muted"}`}
          />
          <span className="text-sm text-fg">{connected ? "Conectado" : "Desconectado"}</span>
        </div>
        <span className="hidden text-sm text-muted md:inline">
          {deviceCount === 0
            ? "Nenhum dispositivo"
            : `${deviceCount} dispositivo${deviceCount > 1 ? "s" : ""}`}
        </span>
        {mode !== "None" && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${MODE_STYLE[mode]}`}>
            {MODE_LABEL[mode]}
          </span>
        )}
        {deviceName && mode !== "None" && (
          <span className="hidden text-sm text-muted lg:inline">{deviceName}</span>
        )}
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-border text-sm font-semibold text-fg">
            O
          </span>
          <span className="hidden text-sm text-fg sm:inline">Operador</span>
        </div>
        <button
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
        >
          Atualizar
        </button>
      </div>
    </header>
  );
}
