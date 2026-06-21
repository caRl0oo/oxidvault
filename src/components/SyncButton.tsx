import { useTranslation } from "react-i18next";

import { syncButtonStatusText } from "@/lib/syncButtonStatus";

interface SyncButtonProps {
  readonly visible: boolean;
  readonly syncing: boolean;
  readonly syncMessage: string | null;
  readonly syncError: string | null;
  readonly onSync: () => void;
}

export function SyncButton({
  visible,
  syncing,
  syncMessage,
  syncError,
  onSync,
}: Readonly<SyncButtonProps>) {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  const title = syncing ? t("sync.syncing") : t("sync.syncGit");
  const statusText = syncButtonStatusText(syncError, syncing, syncMessage, t("sync.syncing"));

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        title={title}
        aria-label={title}
        className="rounded p-1 text-vault-muted transition hover:text-vault-accent disabled:opacity-60"
      >
        <SyncIcon spinning={syncing} />
      </button>

      {(syncing || syncMessage || syncError) && (
        <output
          className={`absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded border px-2 py-1 font-mono text-[10px] shadow-lg ${
            syncError
              ? "border-vault-danger/50 bg-vault-surface text-vault-danger"
              : "border-vault-border bg-vault-surface text-vault-muted"
          }`}
        >
          {statusText}
        </output>
      )}
    </div>
  );
}

function SyncIcon({ spinning }: Readonly<{ spinning: boolean }>) {
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
