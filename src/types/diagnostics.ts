// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import type { DiagnosticOutcome } from "@/lib/diagnosticsLabels";

export interface VaultPathDiagnostics {
  loadedPath: string | null;
  storedPath: string | null;
  isNetworkPath: boolean;
  ok: boolean;
  status: string;
}

export interface PolicyDiagnostics {
  path: string;
  active: boolean;
  ok: boolean;
  status: string;
  policyHash: string | null;
}

export interface AuditLogDiagnostics {
  path: string | null;
  ok: boolean;
  status: string;
  chainValid: boolean | null;
}

export interface VersionDiagnostics {
  version: string;
  ok: boolean;
}

export interface SystemDiagnostics {
  vaultPath: VaultPathDiagnostics;
  policyStatus: PolicyDiagnostics;
  auditLogStatus: AuditLogDiagnostics;
  versionInfo: VersionDiagnostics;
}

export interface DiagnosticRow {
  readonly id: string;
  readonly labelKey: string;
  readonly ok: boolean;
  readonly outcome: DiagnosticOutcome;
  readonly statusCode: string;
  readonly detail?: string;
}

function rowOutcome(checkPassed: boolean): DiagnosticOutcome {
  if (checkPassed) {
    return "success";
  }
  return "error";
}

export function deriveSummaryOutcome(
  rows: ReadonlyArray<Pick<DiagnosticRow, "outcome">>,
): DiagnosticOutcome {
  if (rows.length > 0 && rows.every((row) => row.outcome === "success")) {
    return "success";
  }
  return "error";
}

export function toDiagnosticRows(diagnostics: SystemDiagnostics): DiagnosticRow[] {
  const vaultDetail = [
    diagnostics.vaultPath.loadedPath
      ? `loaded: ${diagnostics.vaultPath.loadedPath}`
      : null,
    diagnostics.vaultPath.storedPath
      ? `stored: ${diagnostics.vaultPath.storedPath}`
      : null,
    diagnostics.vaultPath.isNetworkPath ? "network/UNC" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    {
      id: "vault_path",
      labelKey: "diagnostics.rows.vaultPath",
      ok: diagnostics.vaultPath.ok,
      outcome: rowOutcome(diagnostics.vaultPath.ok),
      statusCode: diagnostics.vaultPath.status,
      detail: vaultDetail || undefined,
    },
    {
      id: "policy_status",
      labelKey: "diagnostics.rows.policyStatus",
      ok: diagnostics.policyStatus.ok,
      outcome: rowOutcome(diagnostics.policyStatus.ok),
      statusCode: diagnostics.policyStatus.status,
      detail: diagnostics.policyStatus.policyHash
        ? `${diagnostics.policyStatus.path} · SHA-256: ${diagnostics.policyStatus.policyHash}`
        : diagnostics.policyStatus.path,
    },
    {
      id: "audit_log_status",
      labelKey: "diagnostics.rows.auditLogStatus",
      ok: diagnostics.auditLogStatus.ok,
      outcome: rowOutcome(diagnostics.auditLogStatus.ok),
      statusCode: diagnostics.auditLogStatus.status,
      detail: diagnostics.auditLogStatus.path ?? undefined,
    },
    {
      id: "version_info",
      labelKey: "diagnostics.rows.versionInfo",
      ok: diagnostics.versionInfo.ok,
      outcome: rowOutcome(diagnostics.versionInfo.ok),
      statusCode: "ok",
      detail: diagnostics.versionInfo.version,
    },
  ];
}
