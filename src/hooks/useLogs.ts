import { useEffect, useState } from "react";
import type { LogEntry } from "../types";
import { clearLogs, onLogEvent, onLogsCleared } from "../lib/ipc";

export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onLogEvent((entry) => setLogs((prev) => [...prev, entry])).then((u) => unsubs.push(u));
    onLogsCleared(() => setLogs([])).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const clear = () => {
    clearLogs().catch(() => {});
  };

  return { logs, clear };
}
