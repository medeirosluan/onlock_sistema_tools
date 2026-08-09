import { useState } from "react";
import type { AppInfo, FrpStatus } from "../types";
import { checkFrpStatus, listApps, manageApps } from "../lib/ipc";

export function useResale() {
  const [frpStatus, setFrpStatus] = useState<FrpStatus | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
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
  const manage = (serial: string, packages: string[], action: "disable" | "uninstall") =>
    run(() => manageApps(serial, packages, action), () => {});

  return {
    frpStatus,
    apps,
    loading,
    error,
    checkFrp: checkFrp,
    listApps: listAppsAction,
    manageApps: manage,
  };
}
