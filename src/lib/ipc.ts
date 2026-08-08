import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AdbStatus, DeviceInfo, LogEntry } from "../types";

export const detectDevice = (platform: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("detect_device", { platform });

export const clearLogs = (): Promise<void> => invoke("clear_logs");

export const getAppVersion = (): Promise<string> => invoke<string>("get_app_version");

export const onLogEvent = (cb: (entry: LogEntry) => void): Promise<() => void> =>
  listen<LogEntry>("log-event", (event) => cb(event.payload));

export const onLogsCleared = (cb: () => void): Promise<() => void> =>
  listen("logs-cleared", () => cb());

export const onAdbStatus = (cb: (status: AdbStatus) => void): Promise<() => void> =>
  listen<AdbStatus>("adb-status", (event) => cb(event.payload));
