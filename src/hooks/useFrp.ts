import { useState } from "react";
import type { FrpResult } from "../types";
import { rebootDevice, runFrpRemoval } from "../lib/ipc";

export function useFrp() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FrpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (serial: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runFrpRemoval(serial));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const reboot = async (serial: string) => {
    setError(null);
    try {
      await rebootDevice(serial);
    } catch (e) {
      setError(String(e));
    }
  };

  return { running, result, error, confirming, setConfirming, run, reboot };
}
