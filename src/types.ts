export type Platform = "samsung" | "xiaomi" | "qualcomm" | "mtk";

export interface DeviceInfo {
  model: string;
  brand: string;
  serial: string;
  android_version: string;
  platform: string;
  connected: boolean;
  battery: number;
  imei: string;
}

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface AdbStatus {
  connected: boolean;
  platform: string | null;
}
