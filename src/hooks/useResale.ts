import { useState } from "react";
import type { AppInfo, DeviceHealth, FrpStatus } from "../types";
import { checkFrpStatus, deviceHealth, listApps, manageApps } from "../lib/ipc";

export function useResale() {
  const [frpStatus, setFrpStatus] = useState<FrpStatus | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(fn: () => Promise<T>, setter: (v: T) => void) => {
    setLoading(true);
    setError(null);
    try {
      setter(await fn());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const checkFrp = (serial: string) => run(() => checkFrpStatus(serial), setFrpStatus);
  const listAppsAction = (serial: string) => run(() => listApps(serial), setApps);
  const getHealth = (serial: string) => run(() => deviceHealth(serial), setHealth);
  const manage = (serial: string, packages: string[], action: "disable" | "uninstall") =>
    run(() => manageApps(serial, packages, action), () => {});

  return {
    frpStatus,
    apps,
    health,
    loading,
    error,
    checkFrp: checkFrp,
    listApps: listAppsAction,
    manageApps: manage,
    getHealth,
  };
}
