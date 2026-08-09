import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AdbDevice, AdbStatus, AppInfo, BackupCategory, BackupProgress, BackupResult, BootloaderResult, ConnectionInfo, DeviceInfo, FormatResult, FrpResult, FrpStatus, LogEntry, ManageAppsResult } from "../types";

export const detectConnectionMode = (): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("detect_connection_mode");

export const detectDevice = (serial: string, platform: string): Promise<DeviceInfo> =>
  invoke<DeviceInfo>("detect_device", { serial, platform });

export const listDevices = (): Promise<AdbDevice[]> => invoke<AdbDevice[]>("list_devices");

export const startAdbServer = (): Promise<void> => invoke("start_adb_server");

export const clearLogs = (): Promise<void> => invoke("clear_logs");

export const getAppVersion = (): Promise<string> => invoke<string>("get_app_version");

export const onLogEvent = (cb: (entry: LogEntry) => void): Promise<() => void> =>
  listen<LogEntry>("log-event", (event) => cb(event.payload));

export const onLogsCleared = (cb: () => void): Promise<() => void> =>
  listen("logs-cleared", () => cb());

export const onAdbStatus = (cb: (status: AdbStatus) => void): Promise<() => void> =>
  listen<AdbStatus>("adb-status", (event) => cb(event.payload));

export const runFrpRemoval = (serial: string): Promise<FrpResult> =>
  invoke<FrpResult>("run_frp_removal", { serial });

export const rebootDevice = (serial: string): Promise<void> =>
  invoke("reboot_device", { serial });

export const unlockBootloader = (serial: string): Promise<BootloaderResult> =>
  invoke<BootloaderResult>("unlock_bootloader", { serial });

export const fastbootReboot = (serial: string): Promise<void> =>
  invoke("fastboot_reboot", { serial });

export const fastbootGetvar = (serial: string, key: string): Promise<string> =>
  invoke<string>("fastboot_getvar", { serial, key });

export const runBackup = (
  serial: string,
  categories: BackupCategory[],
  destination: string,
): Promise<BackupResult> => invoke<BackupResult>("run_backup", { serial, categories, destination });

export const restoreBackup = (
  serial: string,
  destination: string,
  categories: BackupCategory[],
): Promise<BackupResult> => invoke<BackupResult>("restore_backup", { serial, destination, categories });

export const cancelBackup = (): Promise<void> => invoke("cancel_backup");

export const onBackupProgress = (cb: (p: BackupProgress) => void): Promise<() => void> =>
  listen<BackupProgress>("backup-progress", (event) => cb(event.payload));

export const formatUserdata = (serial: string): Promise<FormatResult> =>
  invoke<FormatResult>("format_userdata", { serial });

export const rebootBootloader = (serial: string): Promise<void> =>
  invoke("reboot_bootloader_cmd", { serial });

export const checkFrpStatus = (serial: string): Promise<FrpStatus> =>
  invoke<FrpStatus>("check_frp_status", { serial });

export const listApps = (serial: string): Promise<AppInfo[]> =>
  invoke<AppInfo[]>("list_apps", { serial });

export const manageApps = (
  serial: string,
  packages: string[],
  action: "disable" | "uninstall",
): Promise<ManageAppsResult> => invoke<ManageAppsResult>("manage_apps", { serial, packages, action });
