import { useEffect, useState } from "react";
import type { BackupCategory, BackupProgress, BackupResult } from "../types";
import { cancelBackup, onBackupProgress, restoreBackup, runBackup } from "../lib/ipc";

const CATEGORIES: { id: BackupCategory; label: string }[] = [
  { id: "photos", label: "Fotos" },
  { id: "videos", label: "Vídeos" },
  { id: "music", label: "Música" },
  { id: "downloads", label: "Downloads" },
  { id: "documents", label: "Documentos" },
  { id: "contacts", label: "Contatos" },
  { id: "sms", label: "SMS" },
];

export function useBackup() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    onBackupProgress(setProgress).then((u) => unsubs.push(u));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const run = async (serial: string, categories: BackupCategory[], destination: string) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await runBackup(serial, categories, destination));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const restore = async (serial: string, destination: string, categories: BackupCategory[]) => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      setResult(await restoreBackup(serial, destination, categories));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => {
    cancelBackup().catch(() => {});
  };

  return { categories: CATEGORIES, running, progress, result, error, run, restore, cancel };
}
