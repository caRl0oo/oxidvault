// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";

interface GitSyncStatusIndicatorProps {
  readonly syncing: boolean;
  readonly syncError: string | null;
  readonly onOpenSettings: () => void;
}

export function GitSyncStatusIndicator({
  syncing,
  syncError,
  onOpenSettings,
}: Readonly<GitSyncStatusIndicatorProps>) {
  const { t } = useTranslation();

  const hasError = Boolean(syncError);

  let iconClass = "text-vault-success";
  let hoverTitle = t("sync.connected");

  if (hasError) {
    iconClass = "text-amber-400";
    hoverTitle = syncError ?? t("sync.error");
  } else if (syncing) {
    iconClass = "animate-spin text-vault-accent";
    hoverTitle = t("sync.syncing");
  }

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title={hoverTitle}
      aria-label={hoverTitle}
      className="rounded p-1 text-vault-muted transition hover:bg-vault-border/20 hover:text-vault-accent"
    >
      <GitSyncIcon className={`h-3.5 w-3.5 ${iconClass}`} />
    </button>
  );
}

function GitSyncIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
