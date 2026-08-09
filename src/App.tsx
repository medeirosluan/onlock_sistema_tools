import { useState } from "react";
import { DevicePanel } from "./components/DevicePanel";
import { DeviceSelector } from "./components/DeviceSelector";
import { LogConsole } from "./components/LogConsole";
import { ManufacturerTabs } from "./components/ManufacturerTabs";
import { TopBar } from "./components/TopBar";
import { useAdbStatus } from "./hooks/useAdbStatus";
import { useConnectionMode } from "./hooks/useConnectionMode";
import { useDevices } from "./hooks/useDevices";
import { useLogs } from "./hooks/useLogs";
import { detectDevice, listDevices } from "./lib/ipc";
import type { DeviceInfo, Platform } from "./types";

export default function App() {
  const [activePlatform, setActivePlatform] = useState<Platform>("samsung");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const { devices } = useDevices();
  const { logs, clear } = useLogs();
  const status = useAdbStatus();
  const { mode: connectionMode, device: connectionDevice, serial: connectionSerial } = useConnectionMode();

  const onlineDevices = devices.filter((d) => d.state === "device");

  const runDetect = async (serial: string) => {
    setLoading(true);
    setError(null);
    try {
      const device = await detectDevice(serial, activePlatform);
      setDeviceInfo(device);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    try {
      const list = await listDevices();
      const online = list.filter((d) => d.state === "device");
      if (online.length === 0) {
        setError("Nenhum dispositivo encontrado em ADB.");
        return;
      }
      if (online.length === 1) {
        await runDetect(online[0].serial);
      } else {
        setSelectorOpen(true);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <TopBar
        status={status}
        deviceCount={onlineDevices.length}
        mode={connectionMode}
        deviceName={connectionDevice}
        onRefresh={handleDetect}
      />
      <ManufacturerTabs active={activePlatform} onChange={setActivePlatform} />
      <DevicePanel
        platform={activePlatform}
        device={deviceInfo}
        loading={loading}
        error={error}
        mode={status.mode}
        connectionMode={connectionMode}
        connectionSerial={connectionSerial}
        onDetect={handleDetect}
      />
      <LogConsole logs={logs} onClear={clear} />
      {selectorOpen && (
        <DeviceSelector
          devices={onlineDevices}
          onSelect={(serial) => {
            setSelectorOpen(false);
            runDetect(serial);
          }}
          onCancel={() => setSelectorOpen(false)}
        />
      )}
    </div>
  );
}
