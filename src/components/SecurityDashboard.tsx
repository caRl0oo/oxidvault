import { useCallback, useEffect, useState } from "react";
import { auditVaultSecurity } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import type { SecurityAuditReport } from "@/types/audit";
import { EXPIRY_STATUS_LABELS, WEAK_REASON_LABELS } from "@/types/audit";
import type { DashboardFilter, DashboardFilterKind } from "@/types/dashboardFilter";
import { buildDashboardFilter } from "@/types/dashboardFilter";
import { formatExpiryDate } from "@/lib/expiry";

interface SecurityDashboardProps {
  onSelectEntry?: (entryId: string) => void;
  onApplyFilter?: (filter: DashboardFilter) => void;
  activeFilterKind?: DashboardFilterKind | null;
}

export function SecurityDashboard({
  onSelectEntry,
  onApplyFilter,
  activeFilterKind = null,
}: SecurityDashboardProps) {
  const [report, setReport] = useState<SecurityAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  if (loading && !report) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-mono text-sm text-vault-muted">Analysiere Tresor…</p>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="font-mono text-sm text-vault-danger">{error}</p>
        <button
          type="button"
          onClick={() => void runAudit()}
          className="rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!report) return null;

  const scoreColor =
    report.scorePercent >= 80
      ? "text-vault-success"
      : report.scorePercent >= 50
        ? "text-vault-accent"
        : "text-vault-danger";

  const criticalCount = report.weakCount + report.duplicateEntryCount;

  const hasIssues =
    report.weakCount > 0 ||
    report.duplicateGroupCount > 0 ||
    report.expiringCount > 0;

  const applyTileFilter = (kind: DashboardFilterKind) => {
    const filter = buildDashboardFilter(kind, report);
    if (filter) onApplyFilter?.(filter);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-mono text-lg font-semibold">Security Dashboard</h2>
            <p className="mt-1 font-mono text-xs text-vault-muted">
              Offline-Analyse im RAM · Keine Daten verlassen den Tresor
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runAudit()}
            disabled={loading}
            className="shrink-0 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:border-vault-accent hover:text-vault-accent disabled:opacity-50"
          >
            {loading ? "…" : "Aktualisieren"}
          </button>
        </header>

        <div className="rounded-lg border border-vault-border bg-vault-surface p-5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-vault-muted">
            Vault Security Score
          </p>
          <p className={`mt-1 font-mono text-4xl font-semibold tabular-nums ${scoreColor}`}>
            {report.scorePercent}%
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-vault-border">
            <div
              className={`h-full rounded-full transition-all ${
                report.scorePercent >= 80
                  ? "bg-vault-success"
                  : report.scorePercent >= 50
                    ? "bg-vault-accent"
                    : "bg-vault-danger"
              }`}
              style={{ width: `${report.scorePercent}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] text-vault-muted">
            {report.totalAudited} analysierte Zugangsdaten
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label="Schwache Passwörter"
            value={report.weakCount}
            tone={report.weakCount > 0 ? "danger" : "neutral"}
            clickable={report.weakCount > 0}
            active={activeFilterKind === "weak"}
            onClick={() => applyTileFilter("weak")}
          />
          <MetricTile
            label="Duplikat-Gruppen"
            value={report.duplicateGroupCount}
            tone={report.duplicateGroupCount > 0 ? "danger" : "neutral"}
            clickable={report.duplicateGroupCount > 0}
            active={activeFilterKind === "duplicate"}
            onClick={() => applyTileFilter("duplicate")}
          />
          <MetricTile
            label="Ablaufende Passwörter"
            value={report.expiringCount}
            tone={report.expiringCount > 0 ? "warning" : "neutral"}
            clickable={report.expiringCount > 0}
            active={activeFilterKind === "expiring"}
            onClick={() => applyTileFilter("expiring")}
          />
          <MetricTile
            label="Kritische Warnungen"
            value={criticalCount}
            tone={criticalCount > 0 ? "danger" : "success"}
          />
        </div>

        {report.duplicateGroups.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-vault-muted">
              Doppelte Passwörter
            </h3>
            {report.duplicateGroups.map((group, index) => (
              <div
                key={`dup-${index}`}
                className="rounded border border-vault-danger/30 bg-vault-danger/5 p-3"
              >
                <p className="font-mono text-xs text-vault-danger">
                  {group.count} Einträge teilen dasselbe Passwort
                </p>
                <ul className="mt-2 space-y-1">
                  {group.titles.map((title, i) => (
                    <li key={group.entryIds[i]}>
                      <button
                        type="button"
                        onClick={() => onSelectEntry?.(group.entryIds[i])}
                        className="font-mono text-xs text-vault-text hover:text-vault-accent"
                      >
                        {title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {report.weakEntries.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-vault-muted">
              Schwache Passwörter
            </h3>
            <div className="divide-y divide-vault-border rounded border border-vault-border">
              {report.weakEntries.map((entry) => (
                <div key={entry.entryId} className="flex items-start justify-between gap-3 p-3">
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
                        {WEAK_REASON_LABELS[reason] ?? reason}
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
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-vault-muted">
              Ablaufende Passwörter — To-Do
            </h3>
            <div className="divide-y divide-vault-border rounded border border-vault-border">
              {report.expiringEntries.map((entry) => {
                const isExpired = entry.status === "expired";
                return (
                  <div
                    key={entry.entryId}
                    className={`flex items-start justify-between gap-3 p-3 ${
                      isExpired ? "bg-vault-danger/5" : "bg-amber-500/5"
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
                            ? "border-vault-danger/40 bg-vault-danger/10 text-vault-danger"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        {EXPIRY_STATUS_LABELS[entry.status]}
                      </span>
                      <span className="font-mono text-[10px] text-vault-muted">
                        {formatExpiryDate(entry.expiresAt)}
                        {isExpired
                          ? ` · ${Math.abs(entry.daysUntilExpiry)} T. überfällig`
                          : entry.daysUntilExpiry === 0
                            ? " · heute"
                            : entry.daysUntilExpiry === 1
                              ? " · morgen"
                              : ` · ${entry.daysUntilExpiry} T.`}
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
            Keine Schwachstellen gefunden — weiter so!
          </p>
        )}

        {report.totalAudited === 0 && (
          <p className="text-center font-mono text-xs text-vault-muted">
            Keine analysierbaren Passwörter im Tresor.
          </p>
        )}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
  clickable = false,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  tone: "neutral" | "danger" | "success" | "warning";
  clickable?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-vault-danger/40 bg-vault-danger/10 text-vault-danger"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : tone === "success"
          ? "border-vault-success/40 bg-vault-success/10 text-vault-success"
          : "border-vault-border bg-vault-bg text-vault-text";

  const interactiveClass = clickable
    ? "cursor-pointer transition hover:brightness-110 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-vault-accent"
    : "";

  const activeClass = active ? "ring-1 ring-vault-accent/60" : "";

  const content = (
    <>
      <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 font-mono text-[10px] opacity-80">{label}</p>
      {clickable && (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wider opacity-60">
          In Sidebar filtern →
        </p>
      )}
    </>
  );

  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} — Sidebar filtern`}
        aria-pressed={active}
        className={`rounded border p-3 text-left ${toneClass} ${interactiveClass} ${activeClass}`}
      >
        {content}
      </button>
    );
  }

  return <div className={`rounded border p-3 ${toneClass}`}>{content}</div>;
}
