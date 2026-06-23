import { VaultMainPanel } from "@/components/VaultMainPanel";
import { VaultSshSplitArea } from "@/components/VaultSshSplitArea";
import { VaultWorkspaceModals } from "@/components/VaultWorkspaceModals";
import { VaultWorkspaceSidebar } from "@/components/VaultWorkspaceSidebar";
import {
  buildTerminalLayoutKey,
  formatEntryCountLabel,
  isSshSplitActive,
} from "@/components/vaultWorkspaceHelpers";
import { useResizableSplit } from "@/hooks/useResizableSplit";
import type { ReachabilityState } from "@/types/reachability";
import type { DashboardFilter } from "@/types/dashboardFilter";
import type {
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
} from "@/types/vault";
import type { SshSessionStatus, SshTerminalState } from "@/types/ssh";
import type { VaultMainView } from "@/components/VaultMainPanel";

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
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly sshFocusMode: boolean;
  readonly onToggleSshFocusMode: () => void;
  readonly onCloseSshTerminal: () => void;
  readonly onSshSessionActive: () => void;
  readonly onSshSessionEnded: () => void;
}

export function VaultWorkspace(props: Readonly<VaultWorkspaceProps>) {
  const sshSplitActive = isSshSplitActive(props.sshTerminal, props.sshFocusMode);
  const { vaultWidthPx, containerRef, onDividerPointerDown, layoutReady } = useResizableSplit({
    enabled: sshSplitActive,
  });

  const entryCountLabel = formatEntryCountLabel(
    props.hasSidebarFilter,
    props.filteredEntries.length,
    props.entries.length,
  );
  const terminalLayoutKey = buildTerminalLayoutKey(
    props.sshFocusMode,
    vaultWidthPx ?? "init",
  );

  const vaultPanel = (
    <VaultMainPanel
      vaultMainView={props.vaultMainView}
      selectedEntry={props.selectedEntry}
      entriesCount={props.entries.length}
      dashboardFilterKind={props.dashboardFilter?.kind ?? null}
      onSelectEntry={props.onSelectEntry}
      onApplyDashboardFilter={props.onApplyDashboardFilter}
      onEditEntry={props.onEditEntry}
      onDeleteEntry={props.onDeleteEntry}
      deleteEntryLoading={props.deleteEntryLoading}
      onQuickConnect={props.onQuickConnect}
      sshConnecting={props.sshConnecting}
      reachability={props.reachability}
      sshSessionStatus={props.sshSessionStatus}
      activeSshEntryId={props.sshTerminal?.entryId ?? null}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <VaultWorkspaceSidebar
        vaultMainView={props.vaultMainView}
        onVaultMainViewChange={props.onVaultMainViewChange}
        search={props.search}
        onSearchChange={props.onSearchChange}
        searchRef={props.searchRef}
        entries={props.entries}
        filteredEntries={props.filteredEntries}
        entryCountLabel={entryCountLabel}
        hasSidebarFilter={props.hasSidebarFilter}
        activeTag={props.activeTag}
        onTagChange={props.onTagChange}
        dashboardFilter={props.dashboardFilter}
        onClearDashboardFilter={props.onClearDashboardFilter}
        selectedId={props.selectedId}
        onSelectEntry={props.onSelectEntry}
        onCopyPassword={props.onCopyPassword}
        onOpenWebsite={props.onOpenWebsite}
        onQuickConnect={props.onQuickConnect}
        sshConnecting={props.sshConnecting}
        sidebarCopyingId={props.sidebarCopyingId}
        reachability={props.reachability}
        onShowAddForm={props.onShowAddForm}
      />

      <VaultMainSection
        error={props.error}
        sshTerminal={props.sshTerminal}
        vaultPanel={vaultPanel}
        containerRef={containerRef}
        sshSessionStatus={props.sshSessionStatus}
        sshFocusMode={props.sshFocusMode}
        layoutReady={layoutReady}
        vaultWidthPx={vaultWidthPx}
        terminalLayoutKey={terminalLayoutKey}
        onDividerPointerDown={onDividerPointerDown}
        onToggleSshFocusMode={props.onToggleSshFocusMode}
        onCloseSshTerminal={props.onCloseSshTerminal}
        onSshSessionActive={props.onSshSessionActive}
        onSshSessionEnded={props.onSshSessionEnded}
      />

      <VaultWorkspaceModals
        showAddForm={props.showAddForm}
        editEntry={props.editEntry}
        newSecretPrefillPassword={props.newSecretPrefillPassword}
        loading={props.loading}
        onCloseSecretForm={props.onCloseSecretForm}
        onAddEntry={props.onAddEntry}
        onUpdateEntry={props.onUpdateEntry}
        onOpenGenerator={props.onOpenGenerator}
        showPasswordGenerator={props.showPasswordGenerator}
        onClosePasswordGenerator={props.onClosePasswordGenerator}
        generatorApply={props.generatorApply}
      />
    </div>
  );
}

interface VaultMainSectionProps {
  readonly error: string | null;
  readonly sshTerminal: SshTerminalState | null;
  readonly vaultPanel: React.ReactNode;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly sshFocusMode: boolean;
  readonly layoutReady: boolean;
  readonly vaultWidthPx: number | null;
  readonly terminalLayoutKey: string;
  readonly onDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onToggleSshFocusMode: () => void;
  readonly onCloseSshTerminal: () => void;
  readonly onSshSessionActive: () => void;
  readonly onSshSessionEnded: () => void;
}

function VaultMainSection({
  error,
  sshTerminal,
  vaultPanel,
  containerRef,
  sshSessionStatus,
  sshFocusMode,
  layoutReady,
  vaultWidthPx,
  terminalLayoutKey,
  onDividerPointerDown,
  onToggleSshFocusMode,
  onCloseSshTerminal,
  onSshSessionActive,
  onSshSessionEnded,
}: Readonly<VaultMainSectionProps>) {
  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {sshTerminal ? (
        <VaultSshSplitArea
          containerRef={containerRef}
          vaultPanel={vaultPanel}
          sshTerminal={sshTerminal}
          sshSessionStatus={sshSessionStatus}
          sshFocusMode={sshFocusMode}
          layoutReady={layoutReady}
          vaultWidthPx={vaultWidthPx}
          terminalLayoutKey={terminalLayoutKey}
          onDividerPointerDown={onDividerPointerDown}
          onToggleSshFocusMode={onToggleSshFocusMode}
          onCloseSshTerminal={onCloseSshTerminal}
          onSshSessionActive={onSshSessionActive}
          onSshSessionEnded={onSshSessionEnded}
        />
      ) : (
        vaultPanel
      )}
      {error ? <VaultWorkspaceErrorBanner error={error} /> : null}
    </section>
  );
}

function VaultWorkspaceErrorBanner({ error }: Readonly<{ error: string }>) {
  return (
    <p className="border-t border-vault-border px-4 py-2 font-mono text-xs text-vault-danger">
      {error}
    </p>
  );
}
