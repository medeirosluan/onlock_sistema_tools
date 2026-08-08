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
  mode: "real" | "sim";
}

export interface AdbDevice {
  serial: string;
  state: string;
  model: string | null;
}

export interface FrpResult {
  serial: string;
  success: boolean;
  steps_completed: number;
  message: string;
}

export interface BootloaderResult {
  serial: string;
  success: boolean;
  steps_completed: number;
  message: string;
}

export type BackupCategory =
  | "photos"
  | "videos"
  | "music"
  | "downloads"
  | "documents"
  | "contacts"
  | "sms";

export interface BackupProgress {
  category: string;
  file: string;
  files_done: number;
  total_files: number;
  percent: number;
}

export interface BackupResult {
  serial: string;
  destination: string;
  categories_done: string[];
  files_copied: number;
  message: string;
}
