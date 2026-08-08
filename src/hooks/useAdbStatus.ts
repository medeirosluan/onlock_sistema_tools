import { useEffect, useState } from "react";
import type { AdbStatus } from "../types";
import { onAdbStatus } from "../lib/ipc";

export function useAdbStatus() {
  const [status, setStatus] = useState<AdbStatus>({ connected: false, platform: null });

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onAdbStatus(setStatus).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  return status;
}
