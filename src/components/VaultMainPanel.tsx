// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { AuditLogTable } from "@/components/AuditLogTable";
import { ComplianceDashboard } from "@/dashboard";
import { EmptyVaultState } from "@/components/EmptyVaultState";
import { EntryDetail } from "@/components/EntryDetail";
import { SecurityDashboard } from "@/components/SecurityDashboard";
import type { ReachabilityState } from "@/types/reachability";
import type { DashboardFilter, DashboardFilterKind } from "@/types/dashboardFilter";
import type { SecretEntryPublic } from "@/types/vault";
import type { SshSessionStatus } from "@/types/ssh";

export type VaultMainView = "secrets" | "security" | "activity";

export interface VaultMainPanelProps {
  readonly vaultMainView: VaultMainView;
  readonly selectedEntry: SecretEntryPublic | null;
  readonly entriesCount: number;
  readonly hasSidebarFilter: boolean;
  readonly onCreateEntry: () => void;
  readonly dashboardFilterKind: DashboardFilterKind | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly onEditEntry: (entry: SecretEntryPublic) => void;
  readonly onDeleteEntry: (id: string) => void;
  readonly deleteEntryLoading?: boolean;
  readonly onQuickConnect: (id: string) => void;
  readonly onResetSshFingerprint?: (entryId: string) => void;
  readonly sshConnecting: boolean;
  readonly reachability: Record<string, ReachabilityState>;
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly activeSshEntryId: string | null;
}

export function VaultMainPanel({
  vaultMainView,
  selectedEntry,
  entriesCount,
  hasSidebarFilter,
  onCreateEntry,
  dashboardFilterKind,
  onSelectEntry,
  onApplyDashboardFilter,
  onEditEntry,
  onDeleteEntry,
  deleteEntryLoading,
  onQuickConnect,
  onResetSshFingerprint,
  sshConnecting,
  reachability,
  sshSessionStatus,
  activeSshEntryId,
}: Readonly<VaultMainPanelProps>) {
  if (vaultMainView === "security") {
    return <SecurityMainView onSelectEntry={onSelectEntry} onApplyDashboardFilter={onApplyDashboardFilter} dashboardFilterKind={dashboardFilterKind} />;
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
        onResetSshFingerprint={onResetSshFingerprint}
        sshConnecting={sshConnecting}
        reachability={reachability[selectedEntry.id]}
        sshSessionStatus={
          activeSshEntryId === selectedEntry.id ? sshSessionStatus : null
        }
      />
    );
  }

  return (
    <VaultSecretsPlaceholder
      entriesCount={entriesCount}
      hasSidebarFilter={hasSidebarFilter}
      onCreateEntry={onCreateEntry}
    />
  );
}

interface SecurityMainViewProps {
  readonly onSelectEntry: (id: string) => void;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly dashboardFilterKind: DashboardFilterKind | null;
}

function SecurityMainView({
  onSelectEntry,
  onApplyDashboardFilter,
  dashboardFilterKind,
}: Readonly<SecurityMainViewProps>) {
  return (
    <div className="vault-main-panel">
      <ComplianceDashboard />
      <div className="vault-main-scroll">
        <SecurityDashboard
          onSelectEntry={onSelectEntry}
          onApplyFilter={onApplyDashboardFilter}
          activeFilterKind={dashboardFilterKind}
        />
      </div>
    </div>
  );
}

function VaultSecretsPlaceholder({
  entriesCount,
  hasSidebarFilter,
  onCreateEntry,
}: Readonly<{
  entriesCount: number;
  hasSidebarFilter: boolean;
  onCreateEntry: () => void;
}>) {
  const { t } = useTranslation();

  if (entriesCount === 0 && !hasSidebarFilter) {
    return (
      <div className="vault-main-panel">
        <EmptyVaultState onCreateEntry={onCreateEntry} />
      </div>
    );
  }

  const hint = hasSidebarFilter ? t("vault.noMatches") : t("vault.selectHint");

  return (
    <div className="vault-main-panel items-center justify-center p-8 text-center">
      <p className="text-sm text-vault-muted">{hint}</p>
    </div>
  );
}
