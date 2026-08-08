import type { AdbDevice } from "../types";

interface Props {
  devices: AdbDevice[];
  onSelect: (serial: string) => void;
  onCancel: () => void;
}

export function DeviceSelector({ devices, onSelect, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded border border-border bg-panel p-4">
        <h3 className="text-sm font-semibold text-fg">Selecione um dispositivo</h3>
        <p className="mt-1 text-xs text-muted">{devices.length} dispositivos conectados</p>
        <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {devices.map((device) => (
            <li key={device.serial}>
              <button
                onClick={() => onSelect(device.serial)}
                className="w-full rounded border border-border px-3 py-2 text-left hover:bg-border"
              >
                <p className="font-mono text-sm text-fg">{device.serial}</p>
                {device.model && <p className="text-xs text-muted">{device.model}</p>}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-border"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
