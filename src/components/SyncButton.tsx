interface SyncButtonProps {
  visible: boolean;
  syncing: boolean;
  syncMessage: string | null;
  syncError: string | null;
  onSync: () => void;
}

export function SyncButton({
  visible,
  syncing,
  syncMessage,
  syncError,
  onSync,
}: SyncButtonProps) {
  if (!visible) return null;

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        title={syncing ? "Synchronisiere…" : "Git synchronisieren"}
        aria-label={syncing ? "Synchronisiere…" : "Git synchronisieren"}
        className="rounded p-1 text-vault-muted transition hover:text-vault-accent disabled:opacity-60"
      >
        <SyncIcon spinning={syncing} />
      </button>

      {(syncing || syncMessage || syncError) && (
        <div
          className={`absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded border px-2 py-1 font-mono text-[10px] shadow-lg ${
            syncError
              ? "border-vault-danger/50 bg-vault-surface text-vault-danger"
              : "border-vault-border bg-vault-surface text-vault-muted"
          }`}
          role="status"
        >
          {syncError ?? (syncing ? "Synchronisiere…" : syncMessage)}
        </div>
      )}
    </div>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
