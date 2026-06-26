// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { GitSyncStatusIndicator } from "@/components/GitSyncStatusIndicator";
import { GearIcon } from "@/components/ui/GearIcon";
import { APP_NAME } from "@/lib/appMeta";
import { UI } from "@/lib/uiClasses";

interface LayoutProps {
  readonly children: ReactNode;
  readonly vaultStatus?: ReactNode;
  readonly vaultLocked?: boolean;
  readonly gitSyncEnabled?: boolean;
  readonly gitSyncing?: boolean;
  readonly gitSyncError?: string | null;
  readonly onOpenGitSettings?: () => void;
  readonly onOpenSettings?: () => void;
}

export function Layout({
  children,
  vaultStatus,
  vaultLocked = false,
  gitSyncEnabled = false,
  gitSyncing = false,
  gitSyncError = null,
  onOpenGitSettings,
  onOpenSettings,
}: Readonly<LayoutProps>) {
  const { t } = useTranslation();
  const showHeaderGitSync = !vaultLocked && gitSyncEnabled && !!onOpenGitSettings;
  const hideVaultStatusGitSync = showHeaderGitSync || vaultLocked;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-11 shrink-0 items-center justify-between border-b border-vault-border bg-vault-elevated px-4"
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        <div className="flex items-center gap-2">
          <AppLogo size="sm" className="rounded-md" />
          <span className="text-sm font-semibold text-vault-text">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-3">
          {showHeaderGitSync ? (
            <GitSyncStatusIndicator
              syncing={gitSyncing}
              syncError={gitSyncError}
              onOpenSettings={onOpenGitSettings}
            />
          ) : null}
          <div
            className={
              hideVaultStatusGitSync
                ? "[&>div>button:first-child]:hidden [&>div>div]:border-l-0 [&>div>div]:pl-0"
                : undefined
            }
          >
            {vaultStatus}
          </div>
          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className={`${UI.btnGhost} p-1.5`}
            aria-label={t("settings.title")}
            title={t("settings.title")}
          >
            <GearIcon className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden">{children}</main>
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-vault-border bg-vault-surface px-4 font-mono text-[11px] text-vault-muted">
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>
          {"+"}
          <kbd className="rounded border border-vault-border px-1">K</kbd> {t("shortcuts.search")}
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>
          {"+"}
          <kbd className="rounded border border-vault-border px-1">L</kbd> {t("shortcuts.lock")}
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>
          {"+"}
          <kbd className="rounded border border-vault-border px-1">G</kbd> {t("shortcuts.generator")}
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>
          {"+"}
          <kbd className="rounded border border-vault-border px-1">N</kbd> {t("shortcuts.newSecret")}
        </span>
      </footer>
    </div>
  );
}
