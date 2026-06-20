import type { DashboardFilterKind } from "@/types/dashboardFilter";

interface DashboardFilterBarProps {
  label: string;
  kind: DashboardFilterKind;
  onClear: () => void;
}

const KIND_STYLES: Record<DashboardFilterKind, string> = {
  weak: "border-vault-danger/40 bg-vault-danger/10 text-vault-danger",
  duplicate: "border-vault-danger/40 bg-vault-danger/10 text-vault-danger",
  expiring: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

const KIND_ICONS: Record<DashboardFilterKind, string> = {
  weak: "⚠",
  duplicate: "⎘",
  expiring: "⏳",
};

export function DashboardFilterBar({ label, kind, onClear }: DashboardFilterBarProps) {
  return (
    <div className="border-b border-vault-border px-3 py-2">
      <div
        className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 font-mono text-[10px] ${KIND_STYLES[kind]}`}
      >
        <span className="min-w-0 truncate">
          <span aria-hidden className="mr-1">
            {KIND_ICONS[kind]}
          </span>
          Filter: {label}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Dashboard-Filter aufheben"
          title="Filter aufheben"
          className="shrink-0 rounded px-1 opacity-70 transition hover:bg-black/10 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
