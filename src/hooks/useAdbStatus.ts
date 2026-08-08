import { useEffect, useState } from "react";
import type { AdbStatus } from "../types";
import { onAdbStatus } from "../lib/ipc";

export function useAdbStatus() {
  const [status, setStatus] = useState<AdbStatus>({ connected: false, platform: null });

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];

    const subscribe = (promise: Promise<() => void>) => {
      promise
        .then((un) => {
          if (disposed) un();
          else unsubs.push(un);
        })
        .catch(() => {});
    };

    subscribe(onAdbStatus(setStatus));

    return () => {
      disposed = true;
      unsubs.forEach((fn) => fn());
    };
  }, []);

  return status;
}
