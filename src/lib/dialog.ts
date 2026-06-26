// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { save, open } from "@tauri-apps/plugin-dialog";
import i18n from "@/lib/i18n";

export function normalizeVaultPath(path: string): string {
  return path.toLowerCase().endsWith(".oxid") ? path : `${path}.oxid`;
}

export async function pickVaultSavePath(defaultName = "vault.oxid"): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: i18n.t("dialog.vaultFilter"), extensions: ["oxid"] }],
  });
  return path ? normalizeVaultPath(path) : null;
}

export async function pickVaultOpenPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: i18n.t("dialog.vaultFilter"), extensions: ["oxid"] }],
  });
  return typeof path === "string" ? path : null;
}

export type AuditExportFormat = "json" | "csv";

export interface AuditExportSelection {
  path: string;
  format: AuditExportFormat;
}

function normalizeAuditExportPath(path: string, format: AuditExportFormat): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".csv")) {
    return path;
  }
  return `${path}.${format}`;
}

function auditExportFormatFromPath(path: string): AuditExportFormat {
  return path.toLowerCase().endsWith(".csv") ? "csv" : "json";
}

export async function pickAuditExportPath(): Promise<AuditExportSelection | null> {
  const path = await save({
    defaultPath: "audit-report.json",
    filters: [
      { name: i18n.t("dialog.auditJsonFilter"), extensions: ["json"] },
      { name: i18n.t("dialog.auditCsvFilter"), extensions: ["csv"] },
    ],
  });

  if (!path) {
    return null;
  }

  const format = auditExportFormatFromPath(path);
  return {
    path: normalizeAuditExportPath(path, format),
    format,
  };
}
