// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import i18n from "@/lib/i18n";
import { formatAuditAction } from "@/lib/auditLogLabels";
import type { AuditLogEntry } from "@/types/auditLog";
import type { ComplianceStatus } from "@/types/compliance";
import type { VaultUserPublic } from "@/types/vault";
import type { PdfExportSelection } from "@/components/PdfExportModal";

const DISPLAY_LIMIT = 50;
const BRAND_TEAL: [number, number, number] = [18, 155, 132];
const TEXT_COLOR: [number, number, number] = [26, 26, 26];
const MUTED_COLOR: [number, number, number] = [100, 116, 139];
const OK_COLOR: [number, number, number] = [22, 163, 74];
const WARN_COLOR: [number, number, number] = [217, 119, 6];
const ERROR_COLOR: [number, number, number] = [220, 38, 38];

export interface PdfExportOptions {
  appVersion: string;
  vaultName?: string;
  vaultPath: string;
  exportedBy: VaultUserPublic | null;
  compliance: ComplianceStatus;
  scope: PdfExportSelection;
  totalEntriesAvailable: number;
  logs: AuditLogEntry[];
  logoBase64?: string;
}

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

interface ExplanationBlock {
  title: string;
  body: string;
}

function formatLocalDateTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    return isoUtc;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function drawExplanationSection(
  doc: jsPDF,
  startY: number,
  compliance: ComplianceStatus,
  pageWidth: number,
): void {
  const left = 15;
  const right = pageWidth - 15;
  const width = right - left;
  const pageHeight = doc.internal.pageSize.getHeight();
  const noHmacCheckpoints =
    compliance.auditChainAuthenticated === false &&
    compliance.auditAuthenticationStatus === "audit_no_checkpoints";

  const blocks: ExplanationBlock[] = [
    {
      title: i18n.t("pdfExport.cover.hashChainTitle"),
      body: i18n.t("pdfExport.cover.hashChainBody"),
    },
    ...(noHmacCheckpoints
      ? []
      : [
          {
            title: i18n.t("pdfExport.cover.hmacTitle"),
            body: i18n.t("pdfExport.cover.hmacBody"),
          },
        ]),
    {
      title: i18n.t("pdfExport.cover.privacyTitle"),
      body: i18n.t("pdfExport.cover.privacyBody"),
    },
  ];
  const disclaimer = i18n.t("pdfExport.cover.disclaimer");

  const renderWithSize = (bodyFontSize: number, dryRun: boolean): number => {
    let y = startY;

    if (!dryRun) {
      doc.setDrawColor(...BRAND_TEAL);
      doc.setLineWidth(0.2);
      doc.line(left, y, right, y);
    }
    y += 4;

    if (!dryRun) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...TEXT_COLOR);
      doc.text(i18n.t("pdfExport.cover.explanationTitle"), left, y);
    }
    y += 5;

    for (const block of blocks) {
      if (!dryRun) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...TEXT_COLOR);
        doc.text(block.title, left, y);
      }
      y += 4;

      const bodyLines = doc.splitTextToSize(block.body, width);
      if (!dryRun) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(bodyFontSize);
        doc.setTextColor(...MUTED_COLOR);
        doc.text(bodyLines, left, y);
      }
      y += bodyLines.length * (bodyFontSize * 0.42) + 3.5;
    }

    const disclaimerLines = doc.splitTextToSize(disclaimer, width);
    if (!dryRun) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(bodyFontSize - 0.5);
      doc.setTextColor(...MUTED_COLOR);
      doc.text(disclaimerLines, left, y);
    }
    y += disclaimerLines.length * ((bodyFontSize - 0.5) * 0.42);

    return y;
  };

  const yAt10 = renderWithSize(10, true);
  const finalBodySize = yAt10 > pageHeight - 12 ? 9.5 : 10;
  renderWithSize(finalBodySize, false);
}

function buildComplianceReportPdfDoc(options: PdfExportOptions): jsPDF {
  const {
    appVersion,
    vaultName,
    vaultPath,
    exportedBy,
    compliance,
    scope,
    totalEntriesAvailable,
    logs,
    logoBase64,
  } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const now = new Date();

  let y = 15;
  const reportGeneratedAt = formatLocalDateTime(now.toISOString());
  const includedEvents = logs.length;
  const newestEvent = logs[0]?.timestampUtc;
  const oldestEvent = logs[includedEvents - 1]?.timestampUtc;
  const periodCovered =
    newestEvent && oldestEvent
      ? `${formatLocalDateTime(oldestEvent)} – ${formatLocalDateTime(newestEvent)}`
      : i18n.t("pdfExport.periodUnavailable");
  const reportScopeLabel =
    scope.mode === "dateRange" && scope.fromDate && scope.toDate
      ? `${new Date(scope.fromDate).toLocaleDateString()} – ${new Date(scope.toDate).toLocaleDateString()}`
      : i18n.t("pdfExport.modeLast50");

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", 15, y, 10, 10);
    } catch {
      /* Logo optional */
    }
  }

  const titleX = logoBase64 ? 28 : 15;
  const titleY = y + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...TEXT_COLOR);
  doc.text("Oxid", titleX, titleY);
  const oxidWidth = doc.getTextWidth("Oxid");
  doc.setFont("helvetica", "normal");
  doc.text("Vault", titleX + oxidWidth, titleY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED_COLOR);
  doc.text(i18n.t("audit.reportTitle"), logoBase64 ? 28 : 15, y + 13);

  y += 20;
  doc.setDrawColor(...BRAND_TEAL);
  doc.setLineWidth(0.5);
  doc.line(15, y, pageWidth - 15, y);
  y += 8;

  const metadataRows: [string, string][] = [
    [i18n.t("pdfExport.cover.vault"), vaultName || i18n.t("common.dash")],
    [i18n.t("pdfExport.cover.vaultPath"), vaultPath || i18n.t("common.dash")],
    [i18n.t("pdfExport.cover.exportedAt"), reportGeneratedAt],
    [i18n.t("pdfExport.cover.exportedBy"), exportedBy?.username ?? i18n.t("common.dash")],
    [i18n.t("pdfExport.cover.appVersion"), `v${appVersion}`],
    [i18n.t("pdfExport.cover.reportScope"), reportScopeLabel],
    [
      i18n.t("pdfExport.cover.eventsIncluded"),
      `${includedEvents} ${i18n.t("pdfExport.ofLabel")} ${totalEntriesAvailable}`,
    ],
    [i18n.t("pdfExport.cover.periodCovered"), periodCovered],
  ];

  autoTable(doc, {
    startY: y + 2,
    head: [],
    body: metadataRows,
    theme: "plain",
    styles: {
      fontSize: 9,
      textColor: TEXT_COLOR,
      cellPadding: { top: 1.8, right: 0, bottom: 1.8, left: 0 },
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: "bold", textColor: MUTED_COLOR },
      1: { cellWidth: pageWidth - 15 - 15 - 42 },
    },
    margin: { left: 15, right: 15 },
  });

  y = ((doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? y + 40) + 8;

  const integrityText = (() => {
    if (compliance.auditChainValid && compliance.auditChainAuthenticated) {
      return {
        color: OK_COLOR,
        text: i18n.t("pdfExport.integrity.ok"),
      };
    }
    if (compliance.auditChainValid && compliance.auditChainAuthenticated === false) {
      return {
        color: MUTED_COLOR,
        text:
          compliance.auditAuthenticationStatus === "audit_no_checkpoints"
            ? i18n.t("diagnostics.statusCodes.audit_no_checkpoints")
            : i18n.t("pdfExport.integrity.structuralOnly"),
      };
    }
    return {
      color: ERROR_COLOR,
      text: i18n.t("pdfExport.integrity.invalid"),
    };
  })();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...integrityText.color);
  doc.text(integrityText.text, 15, y);
  y += 6;

  drawExplanationSection(doc, y, compliance, pageWidth);

  doc.addPage();
  y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(i18n.t("pdfExport.tableTitle", { count: Math.min(logs.length, DISPLAY_LIMIT) }), 15, y);
  y += 4;

  const logsToShow = logs.slice(0, DISPLAY_LIMIT);

  const tableRows = logsToShow.map((log) => [
    formatLocalDateTime(log.timestampUtc),
    formatAuditAction(log.action),
    log.entryId || "—",
    log.entryHash ? `${log.entryHash.slice(0, 8)}…` : "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [[i18n.t("audit.colTime"), i18n.t("audit.colAction"), i18n.t("audit.colEntry"), i18n.t("audit.colChecksum")]],
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: BRAND_TEAL,
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: "bold",
    },
    bodyStyles: {
      fontSize: 8,
      textColor: TEXT_COLOR,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 55 },
      2: { cellWidth: 60 },
      3: { cellWidth: 25, font: "courier", fontSize: 7 },
    },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.column.index === 1 && data.section === "body") {
        const action = logsToShow[data.row.index]?.action ?? "";
        if (action === "Checkpoint") {
          data.cell.styles.textColor = BRAND_TEAL;
        } else if (action.includes("Unlocked")) {
          data.cell.styles.textColor = OK_COLOR;
        } else if (action.includes("Revealed") || action.includes("Copied")) {
          data.cell.styles.textColor = WARN_COLOR;
        } else if (action.includes("Deleted") || action.includes("Failed")) {
          data.cell.styles.textColor = ERROR_COLOR;
        } else if (action.includes("Locked")) {
          data.cell.styles.textColor = MUTED_COLOR;
        }
      }
    },
  });

  const finalY = (doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? y + 10;

  if (totalEntriesAvailable > DISPLAY_LIMIT) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_COLOR);
    doc.text(
      i18n.t("pdfExport.tableLimitHint", {
        shown: DISPLAY_LIMIT,
        total: totalEntriesAvailable,
      }),
      15,
      finalY + 6,
    );
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pY = doc.internal.pageSize.getHeight() - 8;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(15, pY - 3, pageWidth - 15, pY - 3);

    doc.setFontSize(8);
    doc.setTextColor(...MUTED_COLOR);
    doc.text(`OxidVault v${appVersion} · oxidvault.com`, 15, pY);
    doc.text(`Seite ${i} / ${pageCount}`, pageWidth - 15, pY, { align: "right" });
  }

  return doc;
}

export function generateComplianceReportPdfBlob(options: PdfExportOptions): Uint8Array {
  const doc = buildComplianceReportPdfDoc(options);
  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}

export async function loadLogoAsBase64(): Promise<string | undefined> {
  try {
    const response = await fetch("/logo.png");
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
