import { useEffect, useRef, useState } from "react";
import type { LogEntry, LogLevel } from "../types";

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-log-info",
  ok: "text-log-ok",
  warn: "text-log-warn",
  error: "text-log-error",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  ok: "OK",
  warn: "WARN",
  error: "ERROR",
};

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

export function LogConsole({ logs, onClear }: Props) {
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const visible = filter === "all" ? logs : logs.filter((log) => log.level === filter);

  return (
    <footer className="flex h-[40%] min-h-[180px] flex-col border-t border-border bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h3 className="text-sm font-semibold text-fg">Console de Logs</h3>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogLevel | "all")}
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
          >
            <option value="all">Todos</option>
            <option value="info">INFO</option>
            <option value="ok">OK</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>
          <button
            onClick={onClear}
            className="rounded border border-border px-2 py-1 text-xs text-fg hover:bg-border"
          >
            Limpar
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-relaxed">
        {visible.length === 0 ? (
          <p className="text-muted">Nenhum log.</p>
        ) : (
          visible.map((log, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-muted">
                {new Date(log.timestamp).toLocaleTimeString("pt-BR")}
              </span>
              <span className={`shrink-0 font-semibold ${LEVEL_STYLE[log.level]}`}>
                {LEVEL_LABEL[log.level]}
              </span>
              <span className="break-words text-fg">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </footer>
  );
}
