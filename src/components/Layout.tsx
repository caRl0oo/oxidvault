import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsMenu } from "@/components/SettingsMenu";
import type { GitSyncSettings } from "@/types/settings";

interface LayoutProps {
  readonly children: ReactNode;
  /** Left command-bar slot: Git sync control or offline indicator. */
  readonly connectionStatus?: ReactNode;
  /** Right command-bar slot: vault lock state, version, lock action. */
  readonly vaultStatus?: ReactNode;
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
}

function OfflineBadge() {
  const { t } = useTranslation();
  return (
    <span className="rounded border border-vault-border/60 bg-vault-border/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-vault-muted">
      {t("common.offline")}
    </span>
  );
}

export function Layout({
  children,
  connectionStatus,
  vaultStatus,
  onGitSyncChange,
}: Readonly<LayoutProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-vault-border/40 bg-vault-bg px-4">
        <div className="flex min-w-0 items-center gap-2">
          {connectionStatus ?? <OfflineBadge />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {vaultStatus}
          <SettingsMenu onGitSyncChange={onGitSyncChange} />
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">{children}</main>
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
