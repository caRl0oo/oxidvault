import { useTranslation } from "react-i18next";
import { AuditLogTable } from "@/components/AuditLogTable";
import { ComplianceDashboard } from "@/dashboard";
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
  readonly dashboardFilterKind: DashboardFilterKind | null;
  readonly onSelectEntry: (id: string) => void;
  readonly onApplyDashboardFilter: (filter: DashboardFilter) => void;
  readonly onEditEntry: (entry: SecretEntryPublic) => void;
  readonly onDeleteEntry: (id: string) => void;
  readonly deleteEntryLoading?: boolean;
  readonly onQuickConnect: (id: string) => void;
  readonly sshConnecting: boolean;
  readonly reachability: Record<string, ReachabilityState>;
  readonly sshSessionStatus: SshSessionStatus | null;
  readonly activeSshEntryId: string | null;
}

export function VaultMainPanel({
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
        sshConnecting={sshConnecting}
        reachability={reachability[selectedEntry.id]}
        sshSessionStatus={
          activeSshEntryId === selectedEntry.id ? sshSessionStatus : null
        }
      />
    );
  }

  return <VaultSecretsPlaceholder entriesCount={entriesCount} />;
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
}: Readonly<{ entriesCount: number }>) {
  const { t } = useTranslation();
  const hint =
    entriesCount === 0 ? t("vault.emptyHint") : t("vault.selectHint");

  return (
    <div className="vault-main-panel items-center justify-center p-8 text-center">
      <p className="text-sm text-vault-muted">{hint}</p>
    </div>
  );
}
