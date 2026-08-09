import { useCallback, useEffect, useState } from "react";
import type { ConnectionInfo } from "../types";
import { detectConnectionMode } from "../lib/ipc";

export function useConnectionMode() {
  const [info, setInfo] = useState<ConnectionInfo>({
    mode: "None",
    device: null,
    serial: null,
    detail: "Nenhum aparelho detectado",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInfo(await detectConnectionMode());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    mode: info.mode,
    device: info.device,
    serial: info.serial,
    detail: info.detail,
    loading,
    error,
    refresh,
  };
}
