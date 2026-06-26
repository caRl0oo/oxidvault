// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SystemDiagnosticsPanel } from "@/components/SystemDiagnosticsPanel";
import { auditVaultSecurity } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import type { DuplicatePasswordGroup, ExpiringPasswordEntry, SecurityAuditReport } from "@/types/audit";
import type { DashboardFilter, DashboardFilterKind } from "@/types/dashboardFilter";
import { buildDashboardFilter } from "@/types/dashboardFilter";
import { formatExpiryDate } from "@/lib/expiry";
import { UI } from "@/lib/uiClasses";

function scoreTextClass(percent: number): string {
  if (percent >= 80) {
    return "text-vault-success";
  }
  if (percent >= 50) {
    return "text-vault-accent";
  }
  return "text-vault-danger";
}

function scoreBarClass(percent: number): string {
  if (percent >= 80) {
    return "bg-vault-success";
  }
  if (percent >= 50) {
    return "bg-vault-accent";
  }
  return "bg-vault-danger";
}

function formatExpirySuffix(
  entry: ExpiringPasswordEntry,
  t: (key: string, options?: { days: number }) => string,
): string {
  if (entry.status === "expired") {
    return ` · ${t("security.expiry_overdue", { days: Math.abs(entry.daysUntilExpiry) })}`;
  }
  if (entry.daysUntilExpiry === 0) {
    return ` · ${t("security.expiry_today")}`;
  }
  if (entry.daysUntilExpiry === 1) {
    return ` · ${t("security.expiry_tomorrow")}`;
  }
  return ` · ${t("security.expiry_in_days", { days: entry.daysUntilExpiry })}`;
}

function duplicateGroupKey(group: DuplicatePasswordGroup): string {
  return group.entryIds.slice().sort((a, b) => a.localeCompare(b)).join("|");
}

type MetricTileTone = "neutral" | "danger" | "success" | "warning";

function metricTileToneClass(tone: MetricTileTone): string {
  if (tone === "danger") {
    return "border-vault-danger/40 bg-vault-danger-subtle text-vault-danger";
  }
  if (tone === "warning") {
    return "border-vault-warning/40 bg-vault-warning-subtle text-vault-warning";
  }
  if (tone === "success") {
    return "border-vault-success/40 bg-vault-success-subtle text-vault-success";
  }
  return "";
}

interface SecurityDashboardProps {
  onSelectEntry?: (entryId: string) => void;
  onApplyFilter?: (filter: DashboardFilter) => void;
  activeFilterKind?: DashboardFilterKind | null;
}

export function SecurityDashboard({
  onSelectEntry,
  onApplyFilter,
  activeFilterKind = null,
}: Readonly<SecurityDashboardProps>) {
  const { t } = useTranslation();
  const [report, setReport] = useState<SecurityAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weakReasonLabel = useCallback(
    (reason: string) => t(`security.weakReason.${reason}`, reason),
    [t],
  );

  const expiryStatusLabel = useCallback(
    (status: ExpiringPasswordEntry["status"]) => t(`security.expiryStatus.${status}`),
    [t],
  );

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await auditVaultSecurity();
      setReport(result);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunAudit = useCallback(() => {
    runAudit();
  }, [runAudit]);

  useEffect(() => {
    const loadAudit = async () => {
      await runAudit();
    };
    loadAudit();
  }, [runAudit]);

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="font-mono text-sm text-vault-muted">{t("security.analyzing")}</p>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8">
        <p className="font-mono text-sm text-vault-danger">{error}</p>
        <button
          type="button"
          onClick={handleRunAudit}
          className={`${UI.btnSecondary} text-xs`}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <SecurityAuditReportView
      report={report}
      loading={loading}
      activeFilterKind={activeFilterKind}
      onRunAudit={handleRunAudit}
      onSelectEntry={onSelectEntry}
      onApplyFilter={onApplyFilter}
      weakReasonLabel={weakReasonLabel}
      expiryStatusLabel={expiryStatusLabel}
      translate={t}
      diagnosticsPanel={<SystemDiagnosticsPanel />}
    />
  );
}

interface SecurityAuditReportViewProps {
  readonly report: SecurityAuditReport;
  readonly loading: boolean;
  readonly activeFilterKind: DashboardFilterKind | null;
  readonly onRunAudit: () => void;
  readonly onSelectEntry?: (entryId: string) => void;
  readonly onApplyFilter?: (filter: DashboardFilter) => void;
  readonly weakReasonLabel: (reason: string) => string;
  readonly expiryStatusLabel: (status: ExpiringPasswordEntry["status"]) => string;
  readonly translate: (key: string, options?: Record<string, unknown>) => string;
  readonly diagnosticsPanel?: React.ReactNode;
}

function SecurityAuditReportView({
  report,
  loading,
  activeFilterKind,
  onRunAudit,
  onSelectEntry,
  onApplyFilter,
  weakReasonLabel,
  expiryStatusLabel,
  translate,
  diagnosticsPanel,
}: SecurityAuditReportViewProps) {
  const criticalCount = report.weakCount + report.duplicateEntryCount;

  const hasIssues =
    report.weakCount > 0 ||
    report.duplicateGroupCount > 0 ||
    report.expiringCount > 0;

  const applyTileFilter = (kind: DashboardFilterKind) => {
    const filter = buildDashboardFilter(kind, report);
    if (filter) {
      onApplyFilter?.(filter);
    }
  };

  return (
    <div className="flex w-full flex-col p-6">
      <div className="w-full space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-mono text-lg font-semibold">{translate("security.title")}</h2>
            <p className="mt-1 font-mono text-xs text-vault-muted">{translate("security.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onRunAudit}
            disabled={loading}
            className={`${UI.btnSecondary} shrink-0 text-xs disabled:opacity-50`}
          >
            {loading ? translate("common.loading") : translate("common.refresh")}
          </button>
        </header>

        {diagnosticsPanel ? <div className="mb-6">{diagnosticsPanel}</div> : null}

        <div className={`${UI.card} p-5`}>
          <span className={UI.fieldLabel}>{translate("security.vault_security_score")}</span>
          <p
            className={`mt-1 font-mono text-4xl font-semibold tabular-nums ${scoreTextClass(report.scorePercent)}`}
          >
            {report.scorePercent}%
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-vault-border">
            <div
              className={`h-full rounded-full transition-all ${scoreBarClass(report.scorePercent)}`}
              style={{ width: `${report.scorePercent}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] text-vault-muted">
            {translate("security.audited_credentials", { count: report.totalAudited })}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3">
          <MetricTile
            label={translate("security.weak_passwords")}
            value={report.weakCount}
            tone={report.weakCount > 0 ? "danger" : "neutral"}
            clickable={report.weakCount > 0}
            active={activeFilterKind === "weak"}
            filterHint={translate("security.filter_sidebar")}
            filterAria={translate("security.filter_sidebar_aria", { label: translate("security.weak_passwords") })}
            onClick={() => applyTileFilter("weak")}
          />
          <MetricTile
            label={translate("security.duplicate_groups")}
            value={report.duplicateGroupCount}
            tone={report.duplicateGroupCount > 0 ? "danger" : "neutral"}
            clickable={report.duplicateGroupCount > 0}
            active={activeFilterKind === "duplicate"}
            filterHint={translate("security.filter_sidebar")}
            filterAria={translate("security.filter_sidebar_aria", { label: translate("security.duplicate_groups") })}
            onClick={() => applyTileFilter("duplicate")}
          />
          <MetricTile
            label={translate("security.expiring_passwords")}
            value={report.expiringCount}
            tone={report.expiringCount > 0 ? "warning" : "neutral"}
            clickable={report.expiringCount > 0}
            active={activeFilterKind === "expiring"}
            filterHint={translate("security.filter_sidebar")}
            filterAria={translate("security.filter_sidebar_aria", {
              label: translate("security.expiring_passwords"),
            })}
            onClick={() => applyTileFilter("expiring")}
          />
          <MetricTile
            label={translate("security.critical_warnings")}
            value={criticalCount}
            tone={criticalCount > 0 ? "danger" : "success"}
          />
        </div>

        {report.duplicateGroups.length > 0 && (
          <section className="space-y-3">
            <h3 className={UI.sectionLabel}>{translate("security.duplicate_section")}</h3>
            {report.duplicateGroups.map((group) => (
              <div
                key={duplicateGroupKey(group)}
                className="rounded border border-vault-danger/30 bg-vault-danger/5 p-3"
              >
                <p className="font-mono text-xs text-vault-danger">
                  {translate("security.duplicate_group", { count: group.count })}
                </p>
                <DuplicateGroupEntryList group={group} onSelectEntry={onSelectEntry} />
              </div>
            ))}
          </section>
        )}

        {report.weakEntries.length > 0 && (
          <section className="space-y-3">
            <h3 className={UI.sectionLabel}>{translate("security.weak_section")}</h3>
            <div className={`${UI.card} divide-y divide-vault-border p-0`}>
              {report.weakEntries.map((entry) => (
                <div
                  key={entry.entryId}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors duration-100 hover:bg-vault-sidebar-item-hover"
                >
                  <button
                    type="button"
                    onClick={() => onSelectEntry?.(entry.entryId)}
                    className="font-mono text-xs text-vault-text hover:text-vault-accent"
                  >
                    {entry.title}
                  </button>
                  <div className="flex flex-wrap justify-end gap-1">
                    {entry.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-vault-tag/40 bg-vault-tag/10 px-2 py-0.5 font-mono text-[10px] text-vault-tag"
                      >
                        {weakReasonLabel(reason)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {report.expiringEntries.length > 0 && (
          <section className="space-y-3">
            <h3 className={UI.sectionLabel}>{translate("security.expiring_section")}</h3>
            <div className={`${UI.card} divide-y divide-vault-border p-0`}>
              {report.expiringEntries.map((entry) => {
                const isExpired = entry.status === "expired";
                return (
                  <div
                    key={entry.entryId}
                    className={`flex items-start justify-between gap-3 px-4 py-3 transition-colors duration-100 hover:bg-vault-sidebar-item-hover ${
                      isExpired ? "bg-vault-danger-subtle/50" : "bg-vault-warning-subtle/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectEntry?.(entry.entryId)}
                      className="text-left font-mono text-xs text-vault-text hover:text-vault-accent"
                    >
                      {entry.title}
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                          isExpired
                            ? "border-vault-danger/40 bg-vault-danger-subtle text-vault-danger"
                            : "border-vault-warning/40 bg-vault-warning-subtle text-vault-warning"
                        }`}
                      >
                        {expiryStatusLabel(entry.status)}
                      </span>
                      <span className="font-mono text-[10px] text-vault-muted">
                        {formatExpiryDate(entry.expiresAt)}
                        {formatExpirySuffix(entry, translate)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {report.totalAudited > 0 && !hasIssues && (
          <p className="rounded border border-vault-success/30 bg-vault-success/5 p-4 text-center font-mono text-xs text-vault-success">
            {translate("security.no_issues")}
          </p>
        )}

        {report.totalAudited === 0 && (
          <p className="text-center font-mono text-xs text-vault-muted">{translate("security.no_passwords")}</p>
        )}
      </div>
    </div>
  );
}

function DuplicateGroupEntryList({
  group,
  onSelectEntry,
}: Readonly<{
  group: DuplicatePasswordGroup;
  onSelectEntry?: (entryId: string) => void;
}>) {
  return (
    <ul className="mt-2 space-y-1">
      {group.entryIds.map((entryId, index) => (
        <li key={entryId}>
          <button
            type="button"
            onClick={() => onSelectEntry?.(entryId)}
            className="font-mono text-xs text-vault-text hover:text-vault-accent"
          >
            {group.titles[index] ?? entryId}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MetricTile({
  label,
  value,
  tone,
  clickable = false,
  active = false,
  filterHint,
  filterAria,
  onClick,
}: Readonly<{
  label: string;
  value: number;
  tone: MetricTileTone;
  clickable?: boolean;
  active?: boolean;
  filterHint?: string;
  filterAria?: string;
  onClick?: () => void;
}>) {
  const toneClass = metricTileToneClass(tone);

  const interactiveClass = clickable
    ? "cursor-pointer transition-shadow duration-150 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-vault-accent"
    : "";

  const activeClass = active ? "ring-1 ring-vault-accent/60" : "";

  const content = (
    <>
      <span className={UI.fieldLabel}>{label}</span>
      {clickable && filterHint ? (
        <span className="text-sm font-medium text-vault-text">{filterHint}</span>
      ) : null}
      <span className={`text-sm font-semibold tabular-nums ${toneClass || "text-vault-text"}`}>
        {value}
      </span>
    </>
  );

  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={filterAria ?? label}
        aria-pressed={active}
        className={`${UI.card} flex flex-col gap-2 text-left ${toneClass} ${interactiveClass} ${activeClass}`}
      >
        {content}
      </button>
    );
  }

  return <div className={`${UI.card} flex flex-col gap-2 ${toneClass}`}>{content}</div>;
}
