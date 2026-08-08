import { useState } from "react";
import type { BootloaderResult } from "../types";
import { fastbootReboot, unlockBootloader } from "../lib/ipc";

export function useBootloader() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BootloaderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (serial: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await unlockBootloader(serial));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const reboot = async (serial: string) => {
    setError(null);
    try {
      await fastbootReboot(serial);
    } catch (e) {
      setError(String(e));
    }
  };

  return { running, result, error, confirming, setConfirming, run, reboot };
}
