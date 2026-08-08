import { useEffect, useState } from "react";
import type { LogEntry } from "../types";
import { clearLogs, onLogEvent, onLogsCleared } from "../lib/ipc";

export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

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

    subscribe(onLogEvent((entry) => setLogs((prev) => [...prev, entry])));
    subscribe(onLogsCleared(() => setLogs([])));

    return () => {
      disposed = true;
      unsubs.forEach((fn) => fn());
    };
  }, []);

  const clear = () => {
    clearLogs().catch(() => {});
  };

  return { logs, clear };
}
