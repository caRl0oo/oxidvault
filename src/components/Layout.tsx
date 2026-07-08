// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { type ReactNode, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { GitSyncStatusIndicator } from "@/components/GitSyncStatusIndicator";
import { TitleBar } from "@/components/TitleBar";
import { GearIcon } from "@/components/ui/GearIcon";
import { isTauri } from "@/lib/ipc";
import { UI } from "@/lib/uiClasses";

function ShortcutHint({ keys, label }: Readonly<{ keys: string[]; label: string }>) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, i) => (
        <Fragment key={key}>
          <kbd
            className="rounded border border-vault-border bg-vault-elevated px-1 py-px text-vault-accent"
            style={{ fontSize: "10px", lineHeight: "14px" }}
          >
            {key}
          </kbd>
          {i < keys.length - 1 ? <span className="text-vault-border">+</span> : null}
        </Fragment>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  );
}

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
      {isTauri() ? (
        <TitleBar
          vaultStatus={vaultStatus}
          vaultLocked={vaultLocked}
          gitSyncEnabled={gitSyncEnabled}
          gitSyncing={gitSyncing}
          gitSyncError={gitSyncError}
          onOpenGitSettings={onOpenGitSettings}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <header
          className="flex h-11 shrink-0 items-center justify-end border-b border-vault-border bg-vault-elevated px-4"
          style={{
            boxShadow: "var(--shadow-sm), inset 0 -1px 0 var(--color-vault-border)",
            borderTop: "1px solid color-mix(in srgb, var(--color-vault-accent) 25%, transparent)",
          }}
        >
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
      )}
      <main className="flex min-h-0 flex-1 overflow-hidden">{children}</main>
      <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-vault-border bg-vault-surface px-4 font-mono text-[10px] text-vault-muted">
        <ShortcutHint keys={["Ctrl", "K"]} label={t("shortcuts.search")} />
        <ShortcutHint keys={["Ctrl", "L"]} label={t("shortcuts.lock")} />
        <ShortcutHint keys={["Ctrl", "G"]} label={t("shortcuts.generator")} />
        <ShortcutHint keys={["Ctrl", "N"]} label={t("shortcuts.newSecret")} />
        <ShortcutHint keys={["Ctrl", "Q"]} label={t("shortcuts.quit")} />
      </footer>
    </div>
  );
}
