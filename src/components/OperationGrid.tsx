import { useState } from "react";
import { useResale } from "../hooks/useResale";
import { formatUserdata, rebootBootloader } from "../lib/ipc";
import type { AppInfo, Platform } from "../types";

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

  const [appsOpen, setAppsOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const {
    frpStatus,
    apps,
    health,
    loading: resaleLoading,
    error: resaleError,
    checkFrp,
    listApps: listAppsAction,
    manageApps: manageAppsAction,
    getHealth,
  } = useResale();

  const toggleApp = (pkg: string) => {
    setSelected((prev) => (prev.includes(pkg) ? prev.filter((p) => p !== pkg) : [...prev, pkg]));
  };

  const openApps = async () => {
    setAppsOpen(true);
    await listAppsAction(serial);
  };

  const handleManage = async (action: "disable" | "uninstall") => {
    if (selected.length === 0) return;
    await manageAppsAction(serial, selected, action);
    await listAppsAction(serial);
    setSelected([]);
  };

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
      {resaleError && (
        <div className="rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
          {resaleError}
        </div>
      )}
      {frpStatus && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            frpStatus.frp_blocked
              ? "border border-log-warn/40 bg-log-warn/10 text-log-warn"
              : "border border-log-ok/40 bg-log-ok/10 text-log-ok"
          }`}
        >
          {frpStatus.message}
        </div>
      )}
      {health && (
        <div className="rounded border border-border bg-panel p-3">
          <h4 className="text-sm font-semibold text-fg">Ficha de Saúde</h4>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <dt className="text-muted">Modelo</dt>
            <dd className="text-fg">{health.model || "—"}</dd>
            <dt className="text-muted">IMEI</dt>
            <dd className="text-fg">{health.imei || "—"}</dd>
            <dt className="text-muted">Android</dt>
            <dd className="text-fg">{health.android_version || "—"}</dd>
            <dt className="text-muted">Build</dt>
            <dd className="text-fg">{health.build || "—"}</dd>
            <dt className="text-muted">Armazenamento total</dt>
            <dd className="text-fg">{health.total_storage || "—"}</dd>
            <dt className="text-muted">Livre</dt>
            <dd className="text-fg">{health.free_storage || "—"}</dd>
            <dt className="text-muted">Bateria</dt>
            <dd className="text-fg">{health.battery}%</dd>
            <dt className="text-muted">FRP</dt>
            <dd className="text-fg">{health.frp_blocked ? "presente" : "limpo"}</dd>
          </dl>
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
      <button onClick={() => checkFrp(serial)} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>{resaleLoading ? "Consultando..." : "Check FRP"}</span>
      </button>
      <button onClick={openApps} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>{resaleLoading ? "Consultando..." : "Apps"}</span>
      </button>
      <button onClick={() => getHealth(serial)} disabled={busy} className={buttonClass}>
        <span className={ACCENT[platform]}>{resaleLoading ? "Consultando..." : "Ficha Saúde"}</span>
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

      {appsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-border bg-panel p-4">
            <h3 className="text-sm font-semibold text-fg">Apps instalados</h3>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar app..."
              className="mt-2 rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <ul className="mt-3 flex-1 overflow-y-auto">
              {apps
                .filter((a: AppInfo) => a.package.toLowerCase().includes(search.toLowerCase()))
                .map((a: AppInfo) => (
                  <li key={a.package} className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={selected.includes(a.package)}
                      onChange={() => toggleApp(a.package)}
                    />
                    <span className="truncate text-xs text-fg">{a.package}</span>
                    {a.system && (
                      <span className="ml-auto rounded bg-border px-1 text-[10px] text-muted">sistema</span>
                    )}
                    {!a.enabled && (
                      <span className="rounded bg-border px-1 text-[10px] text-muted">desativado</span>
                    )}
                  </li>
                ))}
            </ul>
            {resaleError && (
              <div className="mt-2 rounded border border-log-error/40 bg-log-error/10 px-3 py-2 text-sm text-log-error">
                {resaleError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setAppsOpen(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
              >
                Fechar
              </button>
              <button
                onClick={() => handleManage("disable")}
                disabled={selected.length === 0}
                className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border disabled:opacity-50"
              >
                Desativar
              </button>
              <button
                onClick={() => handleManage("uninstall")}
                disabled={selected.length === 0}
                className="rounded bg-log-warn px-3 py-1.5 text-sm text-black hover:opacity-80 disabled:opacity-50"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
