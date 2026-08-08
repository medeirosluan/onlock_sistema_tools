import { useState } from "react";
import { TopBar } from "./components/TopBar";
import { ManufacturerTabs } from "./components/ManufacturerTabs";
import { DevicePanel } from "./components/DevicePanel";
import { LogConsole } from "./components/LogConsole";
import { useAdbStatus } from "./hooks/useAdbStatus";
import { useLogs } from "./hooks/useLogs";
import { detectDevice } from "./lib/ipc";
import type { DeviceInfo, Platform } from "./types";

export default function App() {
  const [activePlatform, setActivePlatform] = useState<Platform>("samsung");
  const [devices, setDevices] = useState<Partial<Record<Platform, DeviceInfo>>>({});
  const [loading, setLoading] = useState(false);
  const { logs, clear } = useLogs();
  const status = useAdbStatus();

  const handleDetect = async () => {
    setLoading(true);
    try {
      const device = await detectDevice(activePlatform);
      setDevices((prev) => ({ ...prev, [activePlatform]: device }));
    } catch {
      // Erro já registrado pelo backend via evento de log; mantém o estado atual.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <TopBar status={status} onRefresh={handleDetect} />
      <ManufacturerTabs active={activePlatform} onChange={setActivePlatform} />
      <DevicePanel
        platform={activePlatform}
        device={devices[activePlatform] ?? null}
        loading={loading}
        onDetect={handleDetect}
      />
      <LogConsole logs={logs} onClear={clear} />
    </div>
  );
}
