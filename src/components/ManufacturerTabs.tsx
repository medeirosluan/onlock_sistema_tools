import type { Platform } from "../types";

const TABS: { id: Platform; label: string; active: string }[] = [
  { id: "samsung", label: "Samsung", active: "border-accent-samsung text-accent-samsung" },
  { id: "xiaomi", label: "Xiaomi", active: "border-accent-xiaomi text-accent-xiaomi" },
  { id: "qualcomm", label: "Qualcomm", active: "border-accent-qualcomm text-accent-qualcomm" },
  { id: "mtk", label: "MTK", active: "border-accent-mtk text-accent-mtk" },
];

interface Props {
  active: Platform;
  onChange: (platform: Platform) => void;
}

export function ManufacturerTabs({ active, onChange }: Props) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border bg-panel px-4 pt-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
            active === tab.id ? `${tab.active} bg-bg` : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
