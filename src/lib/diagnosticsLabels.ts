// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "@/lib/i18n";

export { formatDiagnosticStatus } from "@/lib/errors";

export type DiagnosticOutcome = "success" | "error";

export function diagnosticSuccessLabel(): string {
  return i18n.t("diagnostics.state.ok");
}

export function diagnosticErrorLabel(): string {
  return i18n.t("diagnostics.state.error");
}

export function diagnosticOutcomeLabel(outcome: DiagnosticOutcome): string {
  switch (outcome) {
    case "success":
      return diagnosticSuccessLabel();
    case "error":
      return diagnosticErrorLabel();
  }
}

export function summaryHeadlineForOutcome(
  outcome: DiagnosticOutcome,
  translate: (key: string) => string,
): string {
  switch (outcome) {
    case "success":
      return translate("diagnostics.summaryOk");
    case "error":
      return translate("diagnostics.summaryIssues");
  }
}

export function summaryBannerClassForOutcome(outcome: DiagnosticOutcome): string {
  const base = "mb-3 inline-flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs";
  switch (outcome) {
    case "success":
      return `${base} border-vault-success/40 bg-vault-success/10 text-vault-success`;
    case "error":
      return `${base} border-vault-danger/40 bg-vault-danger/10 text-vault-danger`;
  }
}
