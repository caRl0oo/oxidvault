// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { MODAL_FOOTER_CLASS, MODAL_PANEL_CLASS, UI } from "@/lib/uiClasses";
import type { AuditLogEntry } from "@/types/auditLog";

export type PdfExportMode = "last50" | "dateRange";

export interface PdfExportSelection {
  mode: PdfExportMode;
  fromDate?: string;
  toDate?: string;
}

interface PdfExportModalProps {
  readonly open: boolean;
  readonly loadingLogs: boolean;
  readonly exporting: boolean;
  readonly logs: AuditLogEntry[];
  readonly onClose: () => void;
  readonly onExport: (selection: PdfExportSelection) => void;
}

const TITLE_ID = "pdf-export-modal-title";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDateRange(fromDate: string, toDate: string): { from: Date; to: Date } {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const to = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { from, to };
}

export function PdfExportModal({
  open,
  loadingLogs,
  exporting,
  logs,
  onClose,
  onExport,
}: Readonly<PdfExportModalProps>) {
  const { t } = useTranslation();

  const today = useMemo(() => new Date(), []);
  const firstDayOfMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
    [today],
  );

  const [mode, setMode] = useState<PdfExportMode>("last50");
  const [fromDate, setFromDate] = useState(toDateInputValue(firstDayOfMonth));
  const [toDate, setToDate] = useState(toDateInputValue(today));

  const isRangeValid = useMemo(() => fromDate <= toDate, [fromDate, toDate]);

  const rangeCount = useMemo(() => {
    if (mode !== "dateRange" || !isRangeValid) {
      return 0;
    }
    const { from, to } = parseLocalDateRange(fromDate, toDate);
    return logs.filter((log) => {
      const ts = new Date(log.timestampUtc);
      return !Number.isNaN(ts.getTime()) && ts >= from && ts <= to;
    }).length;
  }, [fromDate, isRangeValid, logs, mode, toDate]);

  const disableExport = exporting || loadingLogs || (mode === "dateRange" && !isRangeValid);

  return (
    <ModalDialog open={open} onClose={onClose} ariaLabelledBy={TITLE_ID} closeDisabled={exporting}>
      <div className={`${MODAL_PANEL_CLASS} max-w-lg`}>
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id={TITLE_ID} className={`${UI.title} text-base`}>
            {t("pdfExport.modalTitle")}
          </h2>
          <p className={`${UI.muted} mt-1 text-xs`}>{t("pdfExport.modalSubtitle")}</p>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-vault-border bg-vault-bg px-3 py-2 text-sm text-vault-text">
              <input
                type="radio"
                name="pdf-export-mode"
                checked={mode === "last50"}
                onChange={() => setMode("last50")}
                className="accent-vault-accent"
              />
              <span>{t("pdfExport.modeLast50")}</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-vault-border bg-vault-bg px-3 py-2 text-sm text-vault-text">
              <input
                type="radio"
                name="pdf-export-mode"
                checked={mode === "dateRange"}
                onChange={() => setMode("dateRange")}
                className="accent-vault-accent"
              />
              <span>{t("pdfExport.modeDateRange")}</span>
            </label>
          </div>

          {mode === "dateRange" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={UI.fieldLabel}>{t("pdfExport.fromLabel")}</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className={UI.input}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={UI.fieldLabel}>{t("pdfExport.toLabel")}</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className={UI.input}
                />
              </label>
            </div>
          ) : null}

          {mode === "dateRange" && !isRangeValid ? (
            <p className="text-xs text-vault-danger">{t("pdfExport.validationRange")}</p>
          ) : null}

          {mode === "dateRange" && loadingLogs ? (
            <p className="text-xs text-vault-muted">{t("pdfExport.loadingEventsHint")}</p>
          ) : null}

          {mode === "dateRange" && !loadingLogs && isRangeValid && rangeCount === 0 ? (
            <p className="text-xs text-vault-warning">{t("pdfExport.emptyRangeHint")}</p>
          ) : null}
        </div>

        <footer className={`${MODAL_FOOTER_CLASS} justify-end`}>
          <button type="button" onClick={onClose} className={`${UI.btnSecondary} px-3 py-1.5 text-sm`}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={disableExport}
            onClick={() =>
              onExport(
                mode === "dateRange" ? { mode, fromDate, toDate } : { mode: "last50" },
              )
            }
            className={`${UI.btnPrimary} px-3 py-1.5 text-sm disabled:opacity-50`}
          >
            {exporting ? t("audit.exporting") : t("pdfExport.exportButton")}
          </button>
        </footer>
      </div>
    </ModalDialog>
  );
}

