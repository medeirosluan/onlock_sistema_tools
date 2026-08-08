import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/ipc";
import type { AdbStatus } from "../types";

interface Props {
  status: AdbStatus;
  onRefresh: () => void;
}

export function TopBar({ status, onRefresh }: Props) {
  const [version, setVersion] = useState("0.1.0");

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
            className={`h-2.5 w-2.5 rounded-full ${status.connected ? "bg-log-ok" : "bg-muted"}`}
          />
          <span className="text-sm text-fg">{status.connected ? "Conectado" : "Desconectado"}</span>
        </div>
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
