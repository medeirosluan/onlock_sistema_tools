import { useCallback, useEffect, useState } from "react";
import type { AdbDevice } from "../types";
import { listDevices, startAdbServer } from "../lib/ipc";

export function useDevices() {
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await listDevices());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startAdbServer().then(refresh).catch(() => {});
  }, [refresh]);

  return { devices, loading, error, refresh };
}
