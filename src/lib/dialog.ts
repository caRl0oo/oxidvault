// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import type { ImportFormat } from "@/import/types";

export function normalizeVaultPath(path: string): string {
  return path.toLowerCase().endsWith(".oxid") ? path : `${path}.oxid`;
}

export async function pickVaultSavePath(defaultName?: string): Promise<string | null> {
  return invoke<string | null>("select_vault_file_via_dialog", {
    mode: "save",
    defaultName: defaultName ?? null,
  });
}

export async function pickVaultOpenPath(): Promise<string | null> {
  return invoke<string | null>("select_vault_file_via_dialog", { mode: "open" });
}

export type AuditExportFormat = "json" | "csv";

export interface AuditExportSelection {
  path: string;
  format: AuditExportFormat;
}

export async function pickAuditExportPath(): Promise<AuditExportSelection | null> {
  return invoke<AuditExportSelection | null>("pick_audit_export_path");
}

export async function pickAuditPdfExportPath(): Promise<string | null> {
  return invoke<string | null>("pick_audit_pdf_export_path");
}

export async function pickImportPath(format: ImportFormat): Promise<string | null> {
  return invoke<string | null>("pick_import_path", { format });
}

export async function readTextFileViaBackend(path: string): Promise<string> {
  return invoke<string>("read_text_file_cmd", { path });
}

export async function writeBinaryFileViaBackend(path: string, data: Uint8Array): Promise<void> {
  return invoke<void>("write_binary_file_cmd", { path, data: Array.from(data) });
}
