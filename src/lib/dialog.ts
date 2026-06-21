import { save, open } from "@tauri-apps/plugin-dialog";

export function normalizeVaultPath(path: string): string {
  return path.toLowerCase().endsWith(".oxid") ? path : `${path}.oxid`;
}

export async function pickVaultSavePath(defaultName = "vault.oxid"): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "OxidVault", extensions: ["oxid"] }],
  });
  return path ? normalizeVaultPath(path) : null;
}

export async function pickVaultOpenPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "OxidVault", extensions: ["oxid"] }],
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
      { name: "JSON Audit Report (.json)", extensions: ["json"] },
      { name: "CSV Audit Report (.csv)", extensions: ["csv"] },
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
