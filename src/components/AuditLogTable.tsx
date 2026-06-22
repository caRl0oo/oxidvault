import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { pickAuditExportPath } from "@/lib/dialog";
import { exportAuditLog, getAuditLogs } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";
import {
  formatAuditAction,
  formatAuditEntryId,
  formatAuditTimestampUtc,
} from "@/lib/auditLogLabels";
import {
  auditActionBadgeClass,
  auditActionToneClass,
  getAuditActionVisual,
} from "@/lib/auditActionVisual";
import { runAsync } from "@/lib/runAsync";
import { BTN_SECONDARY_CLASS } from "@/lib/uiClasses";
import type { AuditLogEntry } from "@/types/auditLog";

const DEFAULT_LIMIT = 200;

interface AuditLogTableProps {
  readonly limit?: number;
}

export function AuditLogTable({ limit = DEFAULT_LIMIT }: Readonly<AuditLogTableProps>) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const logs = await getAuditLogs(limit);
      setEntries(logs);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const handleExport = useCallback(async () => {
    setExportMessage(null);
    setExportSuccess(false);
    const selection = await pickAuditExportPath();
    if (!selection) {
      return;
    }

    setExporting(true);
    try {
      await exportAuditLog(selection.path, selection.format);
      setExportMessage(t("audit.exportSaved", { path: selection.path }));
      setExportSuccess(true);
    } catch (e) {
      setExportMessage(formatVaultError(e));
      setExportSuccess(false);
    } finally {
      setExporting(false);
    }
  }, [t]);

  useEffect(() => {
    runAsync(loadLogs);
  }, [loadLogs]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return entries;
    }
    return entries.filter((entry) => {
      const actionLabel = formatAuditAction(entry.action).toLowerCase();
      const entryId = formatAuditEntryId(entry.action, entry.entryId).toLowerCase();
      const timestamp = formatAuditTimestampUtc(entry.timestampUtc).toLowerCase();
      return (
        entry.action.toLowerCase().includes(query) ||
        actionLabel.includes(query) ||
        entryId.includes(query) ||
        entry.entryHash.toLowerCase().includes(query) ||
        timestamp.includes(query)
      );
    });
  }, [entries, search]);

  const renderBody = () => {
    if (loading && entries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="font-mono text-sm text-vault-muted">{t("audit.loading")}</p>
        </div>
      );
    }

    if (error && entries.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="font-mono text-sm text-vault-danger">{error}</p>
          <button
            type="button"
            onClick={() => runAsync(loadLogs)}
            className="rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text"
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto px-6 py-4">
        {filteredEntries.length === 0 ? (
          <p className="py-8 text-center font-mono text-xs text-vault-muted">
            {search.trim() ? t("audit.noSearchResults") : t("audit.empty")}
          </p>
        ) : (
          <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-vault-border text-left text-vault-muted">
                <th scope="col" className="pb-2 pr-4 font-normal">
                  {t("audit.colTime")}
                </th>
                <th scope="col" className="pb-2 pr-4 font-normal">
                  {t("audit.colAction")}
                </th>
                <th scope="col" className="pb-2 pr-4 font-normal">
                  {t("audit.colEntry")}
                </th>
                <th scope="col" className="pb-2 font-normal">
                  {t("audit.colChecksum")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const visual = getAuditActionVisual(entry.action);
                const Icon = visual.icon;
                const label = formatAuditAction(entry.action);
                return (
                <tr
                  key={`${entry.timestampUtc}-${entry.entryHash}`}
                  className="border-b border-vault-border/60 text-vault-text"
                >
                  <td className="py-2 pr-4 align-top whitespace-nowrap text-vault-muted">
                    {formatAuditTimestampUtc(entry.timestampUtc)}
                  </td>
                  <td className="py-2 pr-4 align-top">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${auditActionBadgeClass(visual.tone)}`}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 shrink-0 ${auditActionToneClass(visual.tone)}`}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>{label}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-4 align-top break-all text-vault-muted">
                    {formatAuditEntryId(entry.action, entry.entryId)}
                  </td>
                  <td className="py-2 align-top break-all text-vault-muted/80">
                    {entry.entryHash.slice(0, 12)}…
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
        {error && entries.length > 0 ? (
          <p className="mt-4 font-mono text-xs text-vault-danger">{error}</p>
        ) : null}
        <p className="mt-4 font-mono text-[10px] text-vault-muted">
          {t("audit.entryCount", { filtered: filteredEntries.length, total: entries.length })}
          {search.trim() ? t("audit.entryCountFiltered") : ""}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-b border-vault-border px-6 py-4">
        <h1 className="font-mono text-sm font-semibold text-vault-text">{t("audit.title")}</h1>
        <p className="mt-1 font-mono text-xs text-vault-muted">{t("audit.subtitle")}</p>
      </header>

      <div className="border-b border-vault-border bg-vault-surface/40 px-6 py-3">
        <p className="font-mono text-xs text-vault-muted">{t("audit.privacyHint")}</p>
      </div>

      <div className="flex items-center gap-3 border-b border-vault-border px-6 py-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("audit.searchPlaceholder")}
          className="min-w-0 flex-1 rounded border border-vault-border bg-vault-bg px-3 py-1.5 font-mono text-xs placeholder:text-vault-muted focus:border-vault-accent outline-none"
        />
        <button
          type="button"
          onClick={() => runAsync(handleExport)}
          disabled={exporting || loading}
          className={BTN_SECONDARY_CLASS}
        >
          {exporting ? t("audit.exporting") : t("common.export")}
        </button>
        <button
          type="button"
          onClick={() => {
            runAsync(loadLogs);
          }}
          disabled={loading}
          className="shrink-0 rounded border border-vault-border px-3 py-1.5 font-mono text-xs text-vault-muted hover:text-vault-text disabled:opacity-50"
        >
          {t("common.refresh")}
        </button>
      </div>

      {exportMessage ? (
        <div className="border-b border-vault-border px-6 py-2">
          <p
            className={`font-mono text-xs ${
              exportSuccess ? "text-vault-success" : "text-vault-danger"
            }`}
          >
            {exportMessage}
          </p>
        </div>
      ) : null}

      {renderBody()}
    </div>
  );
}
