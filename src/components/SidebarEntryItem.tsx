import { useTranslation } from "react-i18next";
import type { SecretEntrySummary } from "@/types/vault";
import { SecretTypeIcon } from "@/components/SecretTypeIcon";
import { ReachabilityDot } from "@/components/ReachabilityDot";
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
  const { t } = useTranslation();
  const canOpenWebsite =
    entry.entry_type === "web_login" &&
    !!entry.subtitle &&
    validateHttpUrl(entry.subtitle).ok;
  const showWebActions = entry.entry_type === "web_login";
  const showSshAction = entry.entry_type === "ssh_key";
  const hasActions = showWebActions || showSshAction;
  const isCopying = copyingId === entry.id;

  return (
    <div
      className={`group mb-1 flex items-center gap-1 rounded px-1.5 py-1 transition ${
        selected
          ? "bg-vault-accent/20 text-vault-text"
          : "text-vault-muted hover:bg-vault-border/50 hover:text-vault-text"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-0.5 text-left"
      >
        <span className="shrink-0 text-vault-accent">
          <SecretTypeIcon kind={entry.entry_type} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-mono text-xs font-medium">
            <ReachabilityDot state={reachability} />
            <span className="truncate">{entry.title}</span>
          </p>
          {entry.subtitle && (
            <p className="truncate font-mono text-[10px] opacity-70">{entry.subtitle}</p>
          )}
          {entry.username && (
            <p className="truncate font-mono text-[10px] opacity-50">{entry.username}</p>
          )}
        </span>
      </button>

      {hasActions && (
        <div
          className={`flex shrink-0 gap-0.5 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {showWebActions && (
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
          )}
          {showSshAction && (
            <QuickActionButton
              title={t("sidebar.quickConnect")}
              ariaLabel={t("sidebar.sshQuickConnect")}
              disabled={sshConnecting}
              accent
              onClick={() => onQuickConnect?.(entry.id)}
            >
              {sshConnecting ? t("common.loading") : "▶"}
            </QuickActionButton>
          )}
        </div>
      )}
    </div>
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition disabled:cursor-not-allowed disabled:opacity-30 ${
        accent
          ? "text-vault-accent hover:bg-vault-accent/15"
          : "text-vault-muted hover:bg-vault-border/60 hover:text-vault-accent"
      }`}
    >
      {children}
    </button>
  );
}
