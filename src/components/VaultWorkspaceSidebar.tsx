// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { Pulse, FolderLock, ShieldChevron } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { DashboardFilterBar } from "@/components/DashboardFilterBar";
import { SidebarEntryList } from "@/components/SidebarEntryList";
import { SidebarNavTab } from "@/components/SidebarNavTab";
import { SidebarTagFilter } from "@/components/SidebarTagFilter";
import type { VaultMainView } from "@/components/VaultMainPanel";
import { UI } from "@/lib/uiClasses";
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
  readonly filteredCount: number;
  readonly totalCount: number;
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
  filteredCount,
  totalCount,
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
    <aside
      className="flex w-80 shrink-0 flex-col border-r bg-vault-sidebar-bg"
      style={{
        borderRightColor: "var(--color-vault-border)",
        borderRightWidth: "1px",
        boxShadow: "1px 0 0 color-mix(in srgb, var(--color-vault-accent) 8%, transparent)",
      }}
    >
      <VaultSidebarNav vaultMainView={vaultMainView} onVaultMainViewChange={onVaultMainViewChange} />
      <div className="border-b border-vault-border p-3">
        <input
          ref={searchRef}
          id="search-input"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("vault.searchPlaceholder")}
          className={UI.input}
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
        filteredCount={filteredCount}
        totalCount={totalCount}
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
          className={`${UI.btnPrimary} w-full text-xs`}
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
    <div className="flex border-b border-vault-border bg-vault-elevated px-2">
      <SidebarNavTab
        icon={FolderLock}
        label={t("nav.secrets")}
        active={vaultMainView === "secrets"}
        onClick={() => onVaultMainViewChange("secrets")}
      />
      <SidebarNavTab
        icon={ShieldChevron}
        label={t("nav.security")}
        active={vaultMainView === "security"}
        onClick={() => onVaultMainViewChange("security")}
      />
      <SidebarNavTab
        icon={Pulse}
        label={t("nav.activity")}
        active={vaultMainView === "activity"}
        onClick={() => onVaultMainViewChange("activity")}
      />
    </div>
  );
}

interface SidebarEntryNavProps {
  readonly filteredCount: number;
  readonly totalCount: number;
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
  filteredCount,
  totalCount,
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
  const countLabel = hasSidebarFilter
    ? t("vault.entryCountFiltered", { filtered: filteredCount, total: totalCount })
    : t("vault.entryCount", { count: totalCount });

  return (
    <nav className="flex-1 overflow-y-auto p-1">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-vault-muted">{countLabel}</span>
      </div>
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
