import { useState } from "react";
import { formatUserdata, rebootBootloader } from "../lib/ipc";
import type { Platform } from "../types";

interface Props {
  platform: Platform;
  serial: string;
  onReadInfo: () => void;
  onEraseFrp: () => void;
}

const ACCENT: Record<Platform, string> = {
  samsung: "text-accent-samsung",
  xiaomi: "text-accent-xiaomi",
  qualcomm: "text-accent-qualcomm",
  mtk: "text-accent-mtk",
};

export function OperationGrid({ platform, serial, onReadInfo, onEraseFrp }: Props) {
  const [rebootOpen, setRebootOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReboot = async () => {
    setRebootOpen(false);
    setError(null);
    setRebooting(true);
    try {
      await rebootBootloader(serial);
    } catch (e) {
      setError(String(e));
    } finally {
      setRebooting(false);
    }
  };

  const handleFormat = async () => {
    setFormatOpen(false);
    setError(null);
    setFormatting(true);
    try {
      await formatUserdata(serial);
    } catch (e) {
      setError(String(e));
    } finally {
      setFormatting(false);
    }
  };

  const busy = rebooting || formatting;
  const buttonClass =
    "flex flex-col items-center justify-center gap-1 rounded border border-border bg-panel p-4 text-sm hover:bg-border disabled:opacity-50";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {error && (
        <div className="rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
          {error}
        </div>
      )}
      <button onClick={onReadInfo} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>Read Info</span>
      </button>
      <button onClick={onEraseFrp} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>Erase FRP</span>
      </button>
      <button onClick={() => setRebootOpen(true)} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>{rebooting ? "Reiniciando..." : "Reboot Fastboot"}</span>
      </button>
      <button onClick={() => setFormatOpen(true)} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>{formatting ? "Formatando..." : "Format Userdata"}</span>
      </button>

      {rebootOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar reinício em fastboot</h3>
            <p className="mt-2 text-sm text-muted">
              Dispositivo: <span className="font-mono text-fg">{serial}</span>
            </p>
            <p className="mt-2 text-xs text-muted">
              O aparelho será reiniciado em modo fastboot (bootloader).
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRebootOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={handleReboot}
                className="rounded bg-accent-samsung px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {formatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Confirmar formatação do userdata</h3>
            <p className="mt-2 text-sm text-muted">
              Dispositivo: <span className="font-mono text-fg">{serial}</span>
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
                onClick={handleFormat}
                className="rounded bg-log-error px-3 py-1.5 text-sm text-white hover:opacity-80"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
