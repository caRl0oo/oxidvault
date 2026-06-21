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
import type { DiagnosticRow, SystemDiagnostics } from "@/types/diagnostics";
import { deriveSummaryOutcome, toDiagnosticRows } from "@/types/diagnostics";

type CopyFeedbackState = "idle" | "copied" | "failed";

function StatusIcon({ ok }: Readonly<{ ok: boolean }>) {
  const toneClass = ok
    ? "bg-vault-success/15 text-vault-success"
    : "bg-vault-danger/15 text-vault-danger";

  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${toneClass}`}
      aria-hidden="true"
    >
      {ok ? "✓" : "!"}
    </span>
  );
}

function DiagnosticRowItem({
  row,
  translate,
}: Readonly<{
  row: DiagnosticRow;
  translate: (key: string) => string;
}>) {
  return (
    <tr className="border-t border-vault-border/60 first:border-t-0">
      <td className="py-2.5 pr-3 align-top">
        <div className="flex items-start gap-2">
          <StatusIcon ok={row.ok} />
          <span className="font-mono text-xs text-vault-text">{translate(row.labelKey)}</span>
        </div>
      </td>
      <td className="py-2.5 pr-3 align-top font-mono text-xs text-vault-muted">
        {formatDiagnosticStatus(row.statusCode)}
      </td>
      <td className="py-2.5 align-top font-mono text-[11px] text-vault-muted">
        {row.detail ?? translate("common.dash")}
      </td>
    </tr>
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
          <span className="font-mono text-[10px] text-vault-muted" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-mono text-sm font-semibold">{translate("diagnostics.title")}</span>
        </button>
        <p className="mt-1 pl-5 font-mono text-[11px] text-vault-muted">
          {translate("diagnostics.subtitle")}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded border border-vault-border px-2.5 py-1 font-mono text-[11px] text-vault-muted hover:text-vault-text disabled:opacity-50"
        >
          {loading ? translate("common.loading") : translate("common.refresh")}
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasDiagnostics || loading}
          className="rounded border border-vault-border px-2.5 py-1 font-mono text-[11px] text-vault-accent hover:border-vault-accent disabled:opacity-50"
        >
          {copyLabel}
        </button>
      </div>
    </header>
  );
}

function DiagnosticsLoadingState({ translate }: Readonly<{ translate: (key: string) => string }>) {
  return <p className="font-mono text-xs text-vault-muted">{translate("diagnostics.loading")}</p>;
}

function DiagnosticsErrorState({
  message,
}: Readonly<{
  message: string;
}>) {
  return <p className="font-mono text-xs text-vault-danger">{message}</p>;
}

function DiagnosticsResultsTable({
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              <th className="pb-2 text-left font-medium">{translate("diagnostics.columnCheck")}</th>
              <th className="pb-2 text-left font-medium">{translate("diagnostics.columnStatus")}</th>
              <th className="pb-2 text-left font-medium">{translate("diagnostics.columnDetail")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DiagnosticRowItem key={row.id} row={row} translate={translate} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[10px] text-vault-muted">
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

  return <DiagnosticsResultsTable rows={rows} summaryOutcome={summaryOutcome} translate={translate} />;
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
    <section className="rounded-lg border border-vault-border bg-vault-surface">
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
