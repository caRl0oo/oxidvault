// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "@/lib/i18n";
import { diagnosticOutcomeLabel, formatDiagnosticStatus } from "@/lib/diagnosticsLabels";
import type { DiagnosticRow, SystemDiagnostics } from "@/types/diagnostics";
import { toDiagnosticRows } from "@/types/diagnostics";

function formatRowMarkdown(row: DiagnosticRow, translate: (key: string) => string): string {
  const status = formatDiagnosticStatus(row.statusCode);
  const state = diagnosticOutcomeLabel(row.outcome);
  const detail = row.detail ? `\n  - ${row.detail}` : "";
  return `- **${translate(row.labelKey)}:** ${state} — ${status}${detail}`;
}

export function buildDiagnosticsMarkdown(
  diagnostics: SystemDiagnostics,
  generatedAt: Date = new Date(),
): string {
  const translate = (key: string) => i18n.t(key);
  const rows = toDiagnosticRows(diagnostics);
  const timestamp = generatedAt.toISOString();

  const lines = [
    `# OxidVault System Diagnostics`,
    "",
    `- **Generated:** ${timestamp}`,
    `- **Application version:** ${diagnostics.versionInfo.version}`,
    "",
    "## Summary",
    "",
    ...rows.map((row) => formatRowMarkdown(row, translate)),
    "",
    "## Raw status codes",
    "",
    ...rows.map((row) => `- ${row.id}: \`${row.statusCode}\` (${row.ok ? "ok" : "error"})`),
  ];

  return lines.join("\n");
}

export async function copyDiagnosticsReport(diagnostics: SystemDiagnostics): Promise<void> {
  const markdown = buildDiagnosticsMarkdown(diagnostics);
  await navigator.clipboard.writeText(markdown);
}
