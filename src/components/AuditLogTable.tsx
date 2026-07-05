// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { writeFile } from "@tauri-apps/plugin-fs";
import { pickAuditExportPath, pickAuditPdfExportPath } from "@/lib/dialog";
import { exportAuditLog, getAuditLogs, getComplianceStatus, getVaultInfo } from "@/lib/ipc";
import { generateComplianceReportPdfBlob, loadLogoAsBase64 } from "@/lib/pdfExport";
import { formatVaultError } from "@/lib/errors";
import {
  formatAuditAction,
  formatAuditEntryId,
  formatAuditTimestampUtc,
} from "@/lib/auditLogLabels";
import { getAuditActionVisual } from "@/lib/auditActionVisual";
import { runAsync } from "@/lib/runAsync";
import { UI } from "@/lib/uiClasses";
import type { AuditLogEntry } from "@/types/auditLog";

const DEFAULT_LIMIT = 200;

const AUDIT_GRID_CLASS =
  "grid grid-cols-[160px_1fr_180px_100px] items-center gap-4";

function getActionStyle(action: string): string {
  if (action.includes("Unlocked") || action.includes("Created")) {
    return "bg-vault-success-subtle text-vault-success";
  }
  if (action.includes("Locked")) {
    return "bg-vault-bg text-vault-muted border border-vault-border";
  }
  if (action.includes("Revealed") || action.includes("Copied")) {
    return "bg-vault-warning-subtle text-vault-warning";
  }
  if (action.includes("Deleted") || action.includes("Failed")) {
    return "bg-vault-danger-subtle text-vault-danger";
  }
  return "bg-vault-accent-subtle text-vault-accent";
}

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
  const [exportingPdf, setExportingPdf] = useState(false);
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

  const handleExportPdf = useCallback(async () => {
    setExportMessage(null);
    setExportSuccess(false);

    const filePath = await pickAuditPdfExportPath();
    if (!filePath) {
      return;
    }

    setExportingPdf(true);
    try {
      const [compliance, logoBase64, vaultInfo] = await Promise.all([
        getComplianceStatus(),
        loadLogoAsBase64(),
        getVaultInfo(),
      ]);

      const pdfBytes = generateComplianceReportPdfBlob({
        vaultPath: vaultInfo.path ?? "",
        compliance,
        logs: entries,
        totalEntries: entries.length,
        logoBase64,
      });

      await writeFile(filePath, pdfBytes);

      setExportMessage(t("audit.exportPdfSuccess", { path: filePath }));
      setExportSuccess(true);
    } catch (e) {
      setExportMessage(formatVaultError(e));
      setExportSuccess(false);
    } finally {
      setExportingPdf(false);
    }
  }, [entries, t]);

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

  const columnHeaders = [
    t("audit.colTime"),
    t("audit.colAction"),
    t("audit.colEntry"),
    t("audit.colChecksum"),
  ];

  const renderBody = () => {
    if (loading && entries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className={UI.muted}>{t("audit.loading")}</p>
        </div>
      );
    }

    if (error && entries.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm text-vault-danger">{error}</p>
          <button
            type="button"
            onClick={() => runAsync(loadLogs)}
            className={`${UI.btnSecondary} text-xs`}
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }

    if (filteredEntries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className={UI.muted}>
            {search.trim() ? t("audit.noSearchResults") : t("audit.empty")}
          </p>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto">
        {filteredEntries.map((entry) => {
          const visual = getAuditActionVisual(entry.action);
          const Icon = visual.icon;
          const label = formatAuditAction(entry.action);
          return (
            <div
              key={`${entry.timestampUtc}-${entry.entryHash}`}
              className={`${AUDIT_GRID_CLASS} border-b border-vault-border px-6 py-2 transition-colors duration-150 hover:bg-vault-sidebar-item-hover`}
            >
              <span className="self-center font-mono text-xs text-vault-muted">
                {formatAuditTimestampUtc(entry.timestampUtc)}
              </span>
              <div className="self-center">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getActionStyle(entry.action)}`}
                >
                  <Icon size={14} weight="light" className="shrink-0" aria-hidden />
                  <span>{label}</span>
                </span>
              </div>
              <span className="self-center truncate font-mono text-xs text-vault-muted">
                {formatAuditEntryId(entry.action, entry.entryId)}
              </span>
              <span className="self-center truncate font-mono text-xs text-vault-muted">
                {entry.entryHash.slice(0, 8)}…
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="vault-main-panel">
      <header className="shrink-0 border-b border-vault-border p-6">
        <h1 className={`${UI.title} text-base`}>{t("audit.title")}</h1>
        <p className={`${UI.muted} mt-1 text-xs`}>{t("audit.subtitle")}</p>
        <div
          className={`${UI.card} mt-3 rounded-lg border-vault-accent bg-vault-accent-subtle p-3 text-xs text-vault-accent`}
        >
          {t("audit.privacyHint")}
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-vault-border px-6 py-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("audit.searchPlaceholder")}
          className={`${UI.input} flex-1 text-sm`}
        />
        <button
          type="button"
          onClick={() => runAsync(handleExport)}
          disabled={exporting || exportingPdf || loading}
          className="vault-btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {exporting ? t("audit.exporting") : t("common.export")}
        </button>
        <button
          type="button"
          onClick={() => runAsync(handleExportPdf)}
          disabled={exporting || exportingPdf || loading}
          className="vault-btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {exportingPdf ? t("audit.exporting") : t("audit.exportPdf")}
        </button>
        <button
          type="button"
          onClick={() => {
            runAsync(loadLogs);
          }}
          disabled={loading}
          className={`${UI.btnGhost} px-3 py-1.5 text-sm disabled:opacity-50`}
        >
          {t("common.refresh")}
        </button>
      </div>

      {exportMessage ? (
        <div className="shrink-0 border-b border-vault-border px-6 py-2">
          <p className={`text-xs ${exportSuccess ? "text-vault-success" : "text-vault-danger"}`}>
            {exportMessage}
          </p>
        </div>
      ) : null}

      <div className={`${AUDIT_GRID_CLASS} shrink-0 border-b border-vault-border px-6 py-2`}>
        {columnHeaders.map((col) => (
          <span key={col} className={UI.fieldLabel}>
            {col}
          </span>
        ))}
      </div>

      {renderBody()}

      {!loading || entries.length > 0 ? (
        <div className="shrink-0 border-t border-vault-border px-6 py-3">
          <p className="text-[10px] text-vault-muted">
            {t("audit.entryCount", { filtered: filteredEntries.length, total: entries.length })}
            {search.trim() ? t("audit.entryCountFiltered") : ""}
          </p>
          {error && entries.length > 0 ? (
            <p className="mt-2 text-xs text-vault-danger">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
