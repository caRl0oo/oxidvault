// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { AuditLogEntry } from "@/types/auditLog";
import type { ComplianceStatus } from "@/types/compliance";

const DISPLAY_LIMIT = 50;
const VERSION = "2.2.0";
const BRAND_COLOR: [number, number, number] = [79, 70, 229];
const TEXT_COLOR: [number, number, number] = [26, 26, 26];
const MUTED_COLOR: [number, number, number] = [100, 116, 139];
const OK_COLOR: [number, number, number] = [22, 163, 74];
const WARN_COLOR: [number, number, number] = [217, 119, 6];
const ERROR_COLOR: [number, number, number] = [220, 38, 38];

export interface PdfExportOptions {
  vaultPath: string;
  compliance: ComplianceStatus;
  logs: AuditLogEntry[];
  totalEntries: number;
  logoBase64?: string;
}

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

function buildComplianceReportPdfDoc(options: PdfExportOptions): jsPDF {
  const { vaultPath, compliance, logs, totalEntries, logoBase64 } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const now = new Date();
  const createdAt =
    now.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " UTC";

  let y = 15;

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", 15, y, 10, 10);
    } catch {
      /* Logo optional */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...BRAND_COLOR);
  doc.text("OxidVault", logoBase64 ? 28 : 15, y + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED_COLOR);
  doc.text("DSGVO Compliance Report", logoBase64 ? 28 : 15, y + 13);

  y += 20;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.5);
  doc.line(15, y, pageWidth - 15, y);
  y += 8;

  doc.setFontSize(9);
  doc.setTextColor(...MUTED_COLOR);
  doc.text("ERSTELLT AM", 15, y);
  doc.text("VAULT", 80, y);
  doc.text("VERSION", 150, y);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(createdAt, 15, y);

  const vaultDisplay =
    vaultPath.length > 40 ? `...${vaultPath.slice(-37)}` : vaultPath;
  doc.text(vaultDisplay, 80, y);
  doc.text(`v${VERSION}`, 150, y);

  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_COLOR);
  doc.text("Compliance-Status", 15, y);
  y += 6;

  const isOk = compliance.auditChainValid && !compliance.keyRotationRecommended;
  const badgeColor = isOk ? OK_COLOR : WARN_COLOR;
  const badgeText = isOk ? "✓  Compliance OK" : "⚠  Handlungsbedarf";

  doc.setFillColor(...badgeColor);
  doc.setDrawColor(...badgeColor);
  doc.roundedRect(15, y, 50, 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(badgeText, 17, y + 4.5);
  y += 12;

  const cards = [
    {
      label: "HASH-KETTE",
      value: compliance.auditChainValid ? "Valide" : "Ungültig",
      color: compliance.auditChainValid ? OK_COLOR : ERROR_COLOR,
    },
    {
      label: "SCHLÜSSEL-ALTER",
      value: `${compliance.keyAgeDays} Tage`,
      color: compliance.keyAgeDays > 90 ? WARN_COLOR : OK_COLOR,
    },
    {
      label: "GPO VERWALTET",
      value: compliance.policyManagedByGpo ? "Ja" : "Nein",
      color: TEXT_COLOR,
    },
  ];

  const cardWidth = (pageWidth - 30 - 10) / 3;
  cards.forEach((card, i) => {
    const x = 15 + i * (cardWidth + 5);

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardWidth, 16, 2, 2, "S");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED_COLOR);
    doc.text(card.label, x + 4, y + 5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 4, y + 12);
  });

  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_COLOR);
  doc.text(`Audit-Ereignisse (letzte ${Math.min(logs.length, DISPLAY_LIMIT)})`, 15, y);
  y += 4;

  const logsToShow = logs.slice(0, DISPLAY_LIMIT);

  const tableRows = logsToShow.map((log) => [
    log.timestampUtc.slice(0, 16).replace("T", " "),
    log.action,
    log.entryId || "—",
    log.entryHash ? `${log.entryHash.slice(0, 8)}…` : "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Zeit (UTC)", "Aktion", "Eintrag-ID", "Prüfsumme"]],
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: BRAND_COLOR,
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
        const action = data.cell.text[0] ?? "";
        if (action.includes("Unlocked")) {
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

  if (totalEntries > DISPLAY_LIMIT) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_COLOR);
    doc.text(
      `Hinweis: Zeigt die letzten ${DISPLAY_LIMIT} von ${totalEntries} Ereignissen. ` +
        "Vollständiger Export als JSON/CSV verfügbar.",
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
    doc.text(`OxidVault v${VERSION} · oxidvault.com`, 15, pY);
    doc.text(`Seite ${i} / ${pageCount}`, pageWidth - 15, pY, { align: "right" });
  }

  return doc;
}

export function generateComplianceReportPdfBlob(options: PdfExportOptions): Uint8Array {
  const doc = buildComplianceReportPdfDoc(options);
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
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
