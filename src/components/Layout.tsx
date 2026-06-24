import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGearButton } from "@/components/SettingsGearButton";

interface LayoutProps {
  readonly children: ReactNode;
  readonly vaultStatus?: ReactNode;
  readonly onOpenSettings?: () => void;
}

export function Layout({
  children,
  vaultStatus,
  onOpenSettings,
}: Readonly<LayoutProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-vault-border/40 bg-vault-bg px-4">
        {vaultStatus}
        <SettingsGearButton onClick={() => onOpenSettings?.()} />
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
