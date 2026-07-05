// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatVaultError } from "@/lib/errors";
import {
  diagnosticOutcomeLabel,
  formatDiagnosticStatus,
  summaryBannerClassForOutcome,
  summaryHeadlineForOutcome,
  type DiagnosticOutcome,
} from "@/lib/diagnosticsLabels";
import { copyDiagnosticsReport } from "@/lib/diagnosticsReport";
import { getSystemDiagnostics } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";
import { UI } from "@/lib/uiClasses";
import type { DiagnosticRow, SystemDiagnostics } from "@/types/diagnostics";
import { deriveSummaryOutcome, toDiagnosticRows } from "@/types/diagnostics";

type CopyFeedbackState = "idle" | "copied" | "failed";

const DIAGNOSTIC_GRID_CLASS = "grid grid-cols-[180px_160px_1fr] items-center gap-4";

function StatusIcon({ ok }: Readonly<{ ok: boolean }>) {
  const toneClass = ok
    ? "bg-vault-success-subtle text-vault-success"
    : "bg-vault-danger-subtle text-vault-danger";

  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${toneClass}`}
      aria-hidden="true"
    >
      {ok ? "✓" : "!"}
    </span>
  );
}

function StatusDot({ ok }: Readonly<{ ok: boolean }>) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        ok
          ? "bg-vault-success shadow-[0_0_5px_1px] shadow-vault-success/50"
          : "bg-vault-danger shadow-[0_0_5px_1px] shadow-vault-danger/50"
      }`}
      aria-hidden="true"
    />
  );
}

function DiagnosticRowItem({
  row,
  translate,
}: Readonly<{
  row: DiagnosticRow;
  translate: (key: string) => string;
}>) {
  const label = translate(row.labelKey);
  const status = formatDiagnosticStatus(row.statusCode);
  const detail = row.detail ?? translate("common.dash");

  return (
    <div
      className={`${DIAGNOSTIC_GRID_CLASS} border-l-2 px-4 py-3 transition-colors duration-150 ${
        row.ok
          ? "border-transparent hover:bg-vault-sidebar-item-hover"
          : "border-vault-danger bg-vault-danger/[0.06] hover:bg-vault-danger/10"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot ok={row.ok} />
        <span className="whitespace-nowrap text-sm text-vault-text">{label}</span>
      </div>
      <span className={`font-mono text-xs ${row.ok ? "text-vault-muted" : "text-vault-danger"}`}>
        {status}
      </span>
      <span className="truncate font-mono text-xs text-vault-muted">{detail}</span>
    </div>
  );
}

function getCopyButtonLabel(
  copyState: CopyFeedbackState,
  translate: (key: string) => string,
): string {
  if (copyState === "copied") {
    return translate("diagnostics.copySuccess");
  }
  if (copyState === "failed") {
    return translate("diagnostics.copyFailed");
  }
  return translate("diagnostics.copyReport");
}

function useCopyFeedbackReset(copyState: CopyFeedbackState, reset: () => void) {
  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = globalThis.setTimeout(reset, 2500);
    return () => globalThis.clearTimeout(timer);
  }, [copyState, reset]);
}

function useSystemDiagnosticsLoader() {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSystemDiagnostics();
      setDiagnostics(result);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsync(refresh);
  }, [refresh]);

  return { diagnostics, loading, error, refresh };
}

function DiagnosticsPanelHeader({
  open,
  loading,
  hasDiagnostics,
  copyLabel,
  onToggle,
  onRefresh,
  onCopy,
  translate,
}: Readonly<{
  open: boolean;
  loading: boolean;
  hasDiagnostics: boolean;
  copyLabel: string;
  onToggle: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  translate: (key: string) => string;
}>) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-vault-border px-4 py-3">
      <div>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className="text-[10px] text-vault-muted" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="text-sm font-semibold text-vault-text">{translate("diagnostics.title")}</span>
        </button>
        <p className={`${UI.muted} mt-1 pl-5`}>{translate("diagnostics.subtitle")}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={`${UI.btnSecondary} px-2.5 py-1 text-[11px] disabled:opacity-50`}
        >
          {loading ? translate("common.loading") : translate("common.refresh")}
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasDiagnostics || loading}
          className={`${UI.btnSecondary} px-2.5 py-1 text-[11px] text-vault-accent disabled:opacity-50`}
        >
          {copyLabel}
        </button>
      </div>
    </header>
  );
}

function DiagnosticsLoadingState({ translate }: Readonly<{ translate: (key: string) => string }>) {
  return <p className={UI.muted}>{translate("diagnostics.loading")}</p>;
}

function DiagnosticsErrorState({
  message,
}: Readonly<{
  message: string;
}>) {
  return <p className="text-sm text-vault-danger">{message}</p>;
}

function DiagnosticsResultsList({
  rows,
  summaryOutcome,
  translate,
}: Readonly<{
  rows: DiagnosticRow[];
  summaryOutcome: DiagnosticOutcome;
  translate: (key: string) => string;
}>) {
  const summaryPassed = summaryOutcome === "success";

  return (
    <>
      <div className={summaryBannerClassForOutcome(summaryOutcome)}>
        <StatusIcon ok={summaryPassed} />
        {summaryHeadlineForOutcome(summaryOutcome, translate)}
      </div>

      <div
        className={`${DIAGNOSTIC_GRID_CLASS} border-b border-l-2 border-transparent border-b-vault-border px-4 py-2`}
      >
        <span className={UI.fieldLabel}>{translate("diagnostics.columnCheck")}</span>
        <span className={UI.fieldLabel}>{translate("diagnostics.columnStatus")}</span>
        <span className={UI.fieldLabel}>{translate("diagnostics.columnDetail")}</span>
      </div>

      <div className="flex flex-col">
        {rows.map((row) => (
          <DiagnosticRowItem key={row.id} row={row} translate={translate} />
        ))}
      </div>

      <p className={`${UI.muted} mt-3 text-[10px]`}>
        {translate("diagnostics.overall")}: {diagnosticOutcomeLabel(summaryOutcome)}
      </p>
    </>
  );
}

function DiagnosticsPanelBody({
  loading,
  diagnostics,
  error,
  rows,
  summaryOutcome,
  translate,
}: Readonly<{
  loading: boolean;
  diagnostics: SystemDiagnostics | null;
  error: string | null;
  rows: DiagnosticRow[];
  summaryOutcome: DiagnosticOutcome;
  translate: (key: string) => string;
}>) {
  if (loading && !diagnostics) {
    return <DiagnosticsLoadingState translate={translate} />;
  }

  if (error && !diagnostics) {
    return <DiagnosticsErrorState message={error} />;
  }

  if (!diagnostics) {
    return null;
  }

  return <DiagnosticsResultsList rows={rows} summaryOutcome={summaryOutcome} translate={translate} />;
}

export function SystemDiagnosticsPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [copyState, setCopyState] = useState<CopyFeedbackState>("idle");
  const { diagnostics, loading, error, refresh } = useSystemDiagnosticsLoader();

  const resetCopyState = useCallback(() => setCopyState("idle"), []);
  useCopyFeedbackReset(copyState, resetCopyState);

  const handleCopy = useCallback(() => {
    if (!diagnostics) {
      return;
    }
    runAsync(async () => {
      try {
        await copyDiagnosticsReport(diagnostics);
        setCopyState("copied");
      } catch {
        setCopyState("failed");
      }
    });
  }, [diagnostics]);

  const rows = diagnostics ? toDiagnosticRows(diagnostics) : [];
  const summaryOutcome = deriveSummaryOutcome(rows);
  const copyLabel = getCopyButtonLabel(copyState, t);

  return (
    <section className={UI.card}>
      <DiagnosticsPanelHeader
        open={open}
        loading={loading}
        hasDiagnostics={diagnostics !== null}
        copyLabel={copyLabel}
        onToggle={() => setOpen((value) => !value)}
        onRefresh={() => runAsync(refresh)}
        onCopy={handleCopy}
        translate={t}
      />

      {open ? (
        <div className="px-4 py-3">
          <DiagnosticsPanelBody
            loading={loading}
            diagnostics={diagnostics}
            error={error}
            rows={rows}
            summaryOutcome={summaryOutcome}
            translate={t}
          />
        </div>
      ) : null}
    </section>
  );
}
