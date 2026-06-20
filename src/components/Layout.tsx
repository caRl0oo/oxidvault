import { type ReactNode } from "react";
import { SettingsMenu } from "@/components/SettingsMenu";
import { AppLogo } from "@/components/AppLogo";
import type { GitSyncSettings } from "@/types/settings";

interface LayoutProps {
  children: ReactNode;
  status?: ReactNode;
  onGitSyncChange?: (settings: GitSyncSettings) => void;
}

export function Layout({ children, status, onGitSyncChange }: LayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-vault-border bg-vault-surface px-4">
        <div className="flex items-center gap-2.5">
          <AppLogo size="sm" />
          <span className="font-mono text-sm font-semibold tracking-tight text-vault-text">
            OxidVault
          </span>
          <span className="rounded bg-vault-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-vault-muted">
            offline
          </span>
        </div>
        <div className="flex items-center gap-3">
          {status}
          <SettingsMenu onGitSyncChange={onGitSyncChange} />
        </div>
      </header>
      <main className="flex flex-1 overflow-hidden">{children}</main>
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-vault-border bg-vault-surface px-4 font-mono text-[11px] text-vault-muted">
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>+
          <kbd className="rounded border border-vault-border px-1">K</kbd> Suche
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>+
          <kbd className="rounded border border-vault-border px-1">L</kbd> Sperren
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>+
          <kbd className="rounded border border-vault-border px-1">G</kbd> Generator
        </span>
        <span>
          <kbd className="rounded border border-vault-border px-1">Ctrl</kbd>+
          <kbd className="rounded border border-vault-border px-1">N</kbd> Neues Secret
        </span>
      </footer>
    </div>
  );
}
