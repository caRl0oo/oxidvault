// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import type { SecretEntrySummary } from "@/types/vault";
import { SecretTypeIcon } from "@/components/SecretTypeIcon";
import { ReachabilityDot } from "@/components/ReachabilityDot";
import { UI } from "@/lib/uiClasses";
import type { ReachabilityState } from "@/types/reachability";
import { validateHttpUrl } from "@/lib/openWebsite";

interface SidebarEntryItemProps {
  entry: SecretEntrySummary;
  selected: boolean;
  onSelect: () => void;
  onCopyPassword?: (entryId: string) => void;
  onOpenWebsite?: (entry: SecretEntrySummary) => void;
  onQuickConnect?: (entryId: string) => void;
  sshConnecting?: boolean;
  copyingId?: string | null;
  reachability?: ReachabilityState;
}

function entrySubtitle(entry: SecretEntrySummary): string | null {
  if (entry.subtitle) {
    return entry.subtitle;
  }
  if (entry.username) {
    return entry.username;
  }
  return null;
}

function itemButtonClass(selected: boolean): string {
  return selected
    ? "bg-vault-accent-subtle text-vault-accent"
    : "text-vault-text hover:bg-vault-sidebar-item-hover";
}

function iconContainerClass(selected: boolean): string {
  return selected ? "bg-vault-accent text-vault-on-accent" : "bg-vault-bg text-vault-muted";
}

function actionsContainerClass(selected: boolean): string {
  return selected ? "opacity-100" : "opacity-0 group-hover:opacity-100";
}

interface SidebarEntryQuickActionsProps {
  readonly entry: SecretEntrySummary;
  readonly selected: boolean;
  readonly copyingId?: string | null;
  readonly sshConnecting?: boolean;
  readonly onCopyPassword?: (entryId: string) => void;
  readonly onOpenWebsite?: (entry: SecretEntrySummary) => void;
  readonly onQuickConnect?: (entryId: string) => void;
}

function SidebarEntryQuickActions({
  entry,
  selected,
  copyingId,
  sshConnecting,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
}: SidebarEntryQuickActionsProps) {
  const { t } = useTranslation();
  const showWebActions = entry.entry_type === "web_login";
  const showSshAction = entry.entry_type === "ssh_key";

  if (!showWebActions && !showSshAction) {
    return null;
  }

  const canOpenWebsite =
    showWebActions && !!entry.subtitle && validateHttpUrl(entry.subtitle).ok;
  const isCopying = copyingId === entry.id;

  return (
    <div className={`flex shrink-0 gap-0.5 transition-opacity ${actionsContainerClass(selected)}`}>
      {showWebActions ? (
        <>
          <QuickActionButton
            title={t("sidebar.copyPassword")}
            ariaLabel={t("sidebar.copyPassword")}
            disabled={isCopying}
            onClick={() => onCopyPassword?.(entry.id)}
          >
            {isCopying ? t("common.loading") : "⎘"}
          </QuickActionButton>
          <QuickActionButton
            title={t("sidebar.openWebsite")}
            ariaLabel={t("sidebar.openWebsite")}
            disabled={!canOpenWebsite}
            onClick={() => onOpenWebsite?.(entry)}
          >
            ↗
          </QuickActionButton>
        </>
      ) : null}
      {showSshAction ? (
        <QuickActionButton
          title={t("sidebar.quickConnect")}
          ariaLabel={t("sidebar.sshQuickConnect")}
          disabled={sshConnecting}
          accent
          onClick={() => onQuickConnect?.(entry.id)}
        >
          {sshConnecting ? t("common.loading") : "▶"}
        </QuickActionButton>
      ) : null}
    </div>
  );
}

export function SidebarEntryItem({
  entry,
  selected,
  onSelect,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
  sshConnecting,
  copyingId,
  reachability,
}: Readonly<SidebarEntryItemProps>) {
  const subtitle = entrySubtitle(entry);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group mx-1 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-100 ${itemButtonClass(selected)}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconContainerClass(selected)}`}
      >
        <SecretTypeIcon kind={entry.entry_type} className="h-3.5 w-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-vault-muted">{subtitle}</div>
        ) : null}
      </div>

      <ReachabilityDot state={reachability} size="sm" />

      <SidebarEntryQuickActions
        entry={entry}
        selected={selected}
        copyingId={copyingId}
        sshConnecting={sshConnecting}
        onCopyPassword={onCopyPassword}
        onOpenWebsite={onOpenWebsite}
        onQuickConnect={onQuickConnect}
      />
    </button>
  );
}

function QuickActionButton({
  children,
  title,
  ariaLabel,
  disabled,
  accent,
  onClick,
}: Readonly<{
  children: React.ReactNode;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  accent?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`${UI.btnGhost} px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-30 ${
        accent ? "text-vault-accent" : ""
      }`}
    >
      {children}
    </button>
  );
}
