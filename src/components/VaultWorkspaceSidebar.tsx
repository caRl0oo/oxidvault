import { Activity, FolderLock, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DashboardFilterBar } from "@/components/DashboardFilterBar";
import { SidebarEntryList } from "@/components/SidebarEntryList";
import { SidebarNavTab } from "@/components/SidebarNavTab";
import { SidebarTagFilter } from "@/components/SidebarTagFilter";
import type { VaultMainView } from "@/components/VaultMainPanel";
import type { ReachabilityState } from "@/types/reachability";
import type { DashboardFilter } from "@/types/dashboardFilter";
import type { SecretEntrySummary } from "@/types/vault";

export interface VaultWorkspaceSidebarProps {
  readonly vaultMainView: VaultMainView;
  readonly onVaultMainViewChange: (view: VaultMainView) => void;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly searchRef: React.RefObject<HTMLInputElement | null>;
  readonly entries: SecretEntrySummary[];
  readonly filteredEntries: SecretEntrySummary[];
  readonly entryCountLabel: string;
  readonly hasSidebarFilter: boolean;
  readonly activeTag: string | null;
  readonly onTagChange: (tag: string | null) => void;
  readonly dashboardFilter: DashboardFilter | null;
  readonly onClearDashboardFilter: () => void;
  readonly selectedId: string | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onCopyPassword: (id: string) => void;
  readonly onOpenWebsite: (entry: SecretEntrySummary) => void;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly sidebarCopyingId: string | null;
  readonly reachability: Record<string, ReachabilityState>;
  readonly onShowAddForm: () => void;
}

export function VaultWorkspaceSidebar({
  vaultMainView,
  onVaultMainViewChange,
  search,
  onSearchChange,
  searchRef,
  entries,
  filteredEntries,
  entryCountLabel,
  hasSidebarFilter,
  activeTag,
  onTagChange,
  dashboardFilter,
  onClearDashboardFilter,
  selectedId,
  onSelectEntry,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
  sshConnecting,
  sidebarCopyingId,
  reachability,
  onShowAddForm,
}: Readonly<VaultWorkspaceSidebarProps>) {
  const { t } = useTranslation();

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-vault-border bg-vault-surface">
      <VaultSidebarNav vaultMainView={vaultMainView} onVaultMainViewChange={onVaultMainViewChange} />
      <div className="border-b border-vault-border p-3">
        <input
          ref={searchRef}
          id="search-input"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("vault.searchPlaceholder")}
          className="w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs placeholder:text-vault-muted focus:border-vault-accent outline-none"
        />
      </div>
      <SidebarTagFilter entries={entries} activeTag={activeTag} onTagChange={onTagChange} />
      {dashboardFilter ? (
        <DashboardFilterBar
          kind={dashboardFilter.kind}
          label={dashboardFilter.label}
          onClear={onClearDashboardFilter}
        />
      ) : null}
      <SidebarEntryNav
        entryCountLabel={entryCountLabel}
        hasSidebarFilter={hasSidebarFilter}
        filteredEntries={filteredEntries}
        selectedId={selectedId}
        onSelectEntry={onSelectEntry}
        onCopyPassword={onCopyPassword}
        onOpenWebsite={onOpenWebsite}
        onQuickConnect={onQuickConnect}
        sshConnecting={sshConnecting}
        sidebarCopyingId={sidebarCopyingId}
        reachability={reachability}
      />
      <div className="border-t border-vault-border p-2">
        <button
          type="button"
          onClick={onShowAddForm}
          className="w-full rounded bg-vault-accent py-1.5 font-mono text-xs text-vault-on-accent hover:bg-vault-accent-hover"
        >
          {t("vault.addSecret")}
        </button>
      </div>
    </aside>
  );
}

interface VaultSidebarNavProps {
  readonly vaultMainView: VaultMainView;
  readonly onVaultMainViewChange: (view: VaultMainView) => void;
}

function VaultSidebarNav({
  vaultMainView,
  onVaultMainViewChange,
}: Readonly<VaultSidebarNavProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-nowrap items-center gap-0.5 border-b border-vault-border bg-vault-bg px-1 pt-1">
      <SidebarNavTab
        icon={FolderLock}
        label={t("nav.secrets")}
        active={vaultMainView === "secrets"}
        onClick={() => onVaultMainViewChange("secrets")}
      />
      <SidebarNavTab
        icon={Shield}
        label={t("nav.security")}
        active={vaultMainView === "security"}
        onClick={() => onVaultMainViewChange("security")}
      />
      <SidebarNavTab
        icon={Activity}
        label={t("nav.activity")}
        active={vaultMainView === "activity"}
        onClick={() => onVaultMainViewChange("activity")}
      />
    </div>
  );
}

interface SidebarEntryNavProps {
  readonly entryCountLabel: string;
  readonly hasSidebarFilter: boolean;
  readonly filteredEntries: SecretEntrySummary[];
  readonly selectedId: string | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onCopyPassword: (id: string) => void;
  readonly onOpenWebsite: (entry: SecretEntrySummary) => void;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly sidebarCopyingId: string | null;
  readonly reachability: Record<string, ReachabilityState>;
}

function SidebarEntryNav({
  entryCountLabel,
  hasSidebarFilter,
  filteredEntries,
  selectedId,
  onSelectEntry,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
  sshConnecting,
  sidebarCopyingId,
  reachability,
}: Readonly<SidebarEntryNavProps>) {
  const { t } = useTranslation();
  const emptyMessage = hasSidebarFilter ? t("vault.noMatches") : t("vault.noEntries");

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-vault-muted">
        {t("vault.entriesCount", { count: entryCountLabel })}
      </p>
      {filteredEntries.length === 0 ? (
        <p className="px-2 py-4 text-center font-mono text-xs text-vault-muted">{emptyMessage}</p>
      ) : (
        <SidebarEntryList
          entries={filteredEntries}
          selectedId={selectedId}
          onSelect={onSelectEntry}
          onCopyPassword={onCopyPassword}
          onOpenWebsite={onOpenWebsite}
          onQuickConnect={onQuickConnect}
          sshConnecting={sshConnecting}
          copyingId={sidebarCopyingId}
          reachability={reachability}
        />
      )}
    </nav>
  );
}
