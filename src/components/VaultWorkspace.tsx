import { useTranslation } from "react-i18next";
import { Activity, FolderLock, Shield } from "lucide-react";
import { AuditLogTable } from "@/components/AuditLogTable";
import { ClipboardToast } from "@/components/ClipboardToast";
import { ComplianceDashboard } from "@/dashboard";
import { DashboardFilterBar } from "@/components/DashboardFilterBar";
import { EntryDetail } from "@/components/EntryDetail";
import { NewSecretModal } from "@/components/NewSecretModal";
import { PasswordGeneratorModal } from "@/components/PasswordGeneratorModal";
import { SecurityDashboard } from "@/components/SecurityDashboard";
import { SidebarEntryList } from "@/components/SidebarEntryList";
import { SidebarNavTab } from "@/components/SidebarNavTab";
import { SidebarTagFilter } from "@/components/SidebarTagFilter";
import { SshTerminalModal } from "@/components/SshTerminalModal";
import type { ReachabilityState } from "@/types/reachability";
import type { DashboardFilter, DashboardFilterKind } from "@/types/dashboardFilter";
import type {
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
} from "@/types/vault";
import type { SshTerminalState } from "@/types/ssh";

type VaultMainView = "secrets" | "security" | "activity";

interface VaultWorkspaceProps {
  readonly vaultMainView: VaultMainView;
  readonly onVaultMainViewChange: (view: VaultMainView) => void;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly searchRef: React.RefObject<HTMLInputElement | null>;
  readonly entries: SecretEntrySummary[];
  readonly filteredEntries: SecretEntrySummary[];
  readonly hasSidebarFilter: boolean;
  readonly activeTag: string | null;
  readonly onTagChange: (tag: string | null) => void;
  readonly dashboardFilter: DashboardFilter | null;
  readonly onClearDashboardFilter: () => void;
  readonly selectedId: string | null;
  readonly selectedEntry: SecretEntryPublic | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onCopyPassword: (id: string) => void;
  readonly onOpenWebsite: (entry: SecretEntrySummary) => void;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly sidebarCopyingId: string | null;
  readonly reachability: Record<string, ReachabilityState>;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly onShowAddForm: () => void;
  readonly onEditEntry: (entry: SecretEntryPublic) => void;
  readonly error: string | null;
  readonly showAddForm: boolean;
  readonly editEntry: SecretEntryPublic | null;
  readonly newSecretPrefillPassword?: string | null;
  readonly loading: boolean;
  readonly onCloseSecretForm: () => void;
  readonly onAddEntry: (input: SecretEntryInputFull) => void;
  readonly onUpdateEntry: (id: string, input: SecretEntryInputFull) => void;
  readonly onDeleteEntry: (id: string) => void;
  readonly deleteEntryLoading?: boolean;
  readonly onOpenGenerator: (apply?: (pwd: string) => void) => void;
  readonly showPasswordGenerator: boolean;
  readonly onClosePasswordGenerator: () => void;
  readonly generatorApply?: (pwd: string) => void;
  readonly sshTerminal: SshTerminalState | null;
  readonly onCloseSshTerminal: () => void;
}

export function VaultWorkspace({
  vaultMainView,
  onVaultMainViewChange,
  search,
  onSearchChange,
  searchRef,
  entries,
  filteredEntries,
  hasSidebarFilter,
  activeTag,
  onTagChange,
  dashboardFilter,
  onClearDashboardFilter,
  selectedId,
  selectedEntry,
  onSelectEntry,
  onCopyPassword,
  onOpenWebsite,
  onQuickConnect,
  sshConnecting,
  sidebarCopyingId,
  reachability,
  onApplyDashboardFilter,
  onShowAddForm,
  onEditEntry,
  error,
  showAddForm,
  editEntry,
  newSecretPrefillPassword,
  loading,
  onCloseSecretForm,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  deleteEntryLoading,
  onOpenGenerator,
  showPasswordGenerator,
  onClosePasswordGenerator,
  generatorApply,
  sshTerminal,
  onCloseSshTerminal,
}: Readonly<VaultWorkspaceProps>) {
  const { t } = useTranslation();
  const entryCountLabel = hasSidebarFilter
    ? `${filteredEntries.length}/${entries.length}`
    : String(entries.length);

  return (
    <div className="flex flex-1">
      <aside className="flex w-80 shrink-0 flex-col border-r border-vault-border bg-vault-surface">
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
        <nav className="flex-1 overflow-y-auto p-2">
          <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-vault-muted">
            {t("vault.entriesCount", { count: entryCountLabel })}
          </p>
          {filteredEntries.length === 0 ? (
            <p className="px-2 py-4 text-center font-mono text-xs text-vault-muted">
              {hasSidebarFilter ? t("vault.noMatches") : t("vault.noEntries")}
            </p>
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

      <section className="relative flex flex-1 flex-col overflow-hidden">
        <VaultMainPanel
          vaultMainView={vaultMainView}
          selectedEntry={selectedEntry}
          entriesCount={entries.length}
          dashboardFilterKind={dashboardFilter?.kind ?? null}
          onSelectEntry={onSelectEntry}
          onApplyDashboardFilter={onApplyDashboardFilter}
          onEditEntry={onEditEntry}
          onDeleteEntry={onDeleteEntry}
          deleteEntryLoading={deleteEntryLoading}
          onQuickConnect={onQuickConnect}
          sshConnecting={sshConnecting}
          reachability={reachability}
        />
        {error ? (
          <p className="border-t border-vault-border px-4 py-2 font-mono text-xs text-vault-danger">
            {error}
          </p>
        ) : null}
      </section>

      <NewSecretModal
        open={showAddForm || editEntry !== null}
        mode={editEntry ? "edit" : "create"}
        editEntry={editEntry ?? undefined}
        initialPassword={newSecretPrefillPassword ?? undefined}
        loading={loading}
        onClose={onCloseSecretForm}
        onSubmit={onAddEntry}
        onUpdate={onUpdateEntry}
        onOpenGenerator={onOpenGenerator}
      />
      <PasswordGeneratorModal
        open={showPasswordGenerator}
        onClose={onClosePasswordGenerator}
        onApply={generatorApply}
      />
      <ClipboardToast />
      {sshTerminal ? (
        <SshTerminalModal state={sshTerminal} onClose={onCloseSshTerminal} />
      ) : null}
    </div>
  );
}

interface VaultMainPanelProps {
  readonly vaultMainView: VaultMainView;
  readonly selectedEntry: SecretEntryPublic | null;
  readonly entriesCount: number;
  readonly dashboardFilterKind: DashboardFilterKind | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly onEditEntry: (entry: SecretEntryPublic) => void;
  readonly onDeleteEntry: (id: string) => void;
  readonly deleteEntryLoading?: boolean;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly reachability: Record<string, ReachabilityState>;
}

function VaultMainPanel({
  vaultMainView,
  selectedEntry,
  entriesCount,
  dashboardFilterKind,
  onSelectEntry,
  onApplyDashboardFilter,
  onEditEntry,
  onDeleteEntry,
  deleteEntryLoading,
  onQuickConnect,
  sshConnecting,
  reachability,
}: VaultMainPanelProps) {
  if (vaultMainView === "security") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <ComplianceDashboard />
        <SecurityDashboard
          onSelectEntry={onSelectEntry}
          onApplyFilter={onApplyDashboardFilter}
          activeFilterKind={dashboardFilterKind}
        />
      </div>
    );
  }

  if (vaultMainView === "activity") {
    return <AuditLogTable />;
  }

  if (selectedEntry) {
    return (
      <EntryDetail
        entry={selectedEntry}
        onEdit={() => onEditEntry(selectedEntry)}
        onDelete={() => onDeleteEntry(selectedEntry.id)}
        deleteLoading={deleteEntryLoading}
        onQuickConnect={onQuickConnect}
        sshConnecting={sshConnecting}
        reachability={reachability[selectedEntry.id]}
      />
    );
  }

  return <VaultSecretsPlaceholder entriesCount={entriesCount} />;
}

function VaultSecretsPlaceholder({
  entriesCount,
}: {
  readonly entriesCount: number;
}) {
  const { t } = useTranslation();
  const emptyVault = entriesCount === 0;
  const hint = emptyVault ? t("vault.emptyHint") : t("vault.selectHint");

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-vault-muted">{hint}</p>
    </div>
  );
}
