import { useEffect, useState } from "react";
import type { FlashProgress, FlashResult } from "../types";
import { flashFirmware, onFlashProgress } from "../lib/ipc";

export function useFlash() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [result, setResult] = useState<FlashResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onFlashProgress(setProgress).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const run = async (serial: string, url: string, partition?: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await flashFirmware(serial, url, partition));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return { running, progress, result, error, run };
}
