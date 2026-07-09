// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { pickImportPath, readTextFileViaBackend } from "@/lib/dialog";
import { runAsync } from "@/lib/runAsync";
import {
  CONFIRM_PANEL_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_PANEL_CLASS,
  NOTE_PANEL_CLASS,
  UI,
} from "@/lib/uiClasses";
import {
  IMPORT_FORMATS,
  buildImportPreview,
  executeImport,
  parseImportFile,
  validateImportFormat,
} from "@/import";
import type { ImportExecutionResult, ImportFormat, ImportPreview, ParseResult } from "@/import/types";
import type { SecretEntryInputFull, SecretEntrySummary } from "@/types/vault";

const TITLE_ID = "import-modal-title";
const PREVIEW_SAMPLE_SIZE = 5;

const panelClass = `${MODAL_PANEL_CLASS} max-w-2xl overflow-hidden rounded-lg border-vault-border bg-vault-elevated p-0 [box-shadow:var(--shadow-lg)]`;

const footerClass = `${MODAL_FOOTER_CLASS} justify-end bg-vault-bg/40 px-6`;

const bodyClass = "min-h-0 flex-1 overflow-y-auto bg-vault-bg/30 px-6 py-5";

const headerClass = "border-b border-vault-border px-6 py-4";

type ImportStep = "format" | "file" | "confirm" | "result";

function highlightNumbers(text: string): ReactNode {
  return text.split(/(\d+)/g).map((part, index) =>
    /^\d+$/.test(part) ? (
      <span key={`${part}-${index}`} className="font-semibold text-vault-accent">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function formatOptionClass(selected: boolean): string {
  return `flex cursor-pointer items-start gap-3 rounded-md border p-4 text-left transition-all duration-150 ${
    selected
      ? "border-vault-accent bg-vault-accent-subtle ring-1 ring-vault-accent/30"
      : "border-vault-border bg-vault-bg hover:border-vault-border-focus hover:bg-vault-sidebar-item-hover"
  }`;
}

function formatLabelClass(selected: boolean): string {
  return `text-sm font-medium ${selected ? "text-vault-accent" : "text-vault-text"}`;
}

interface ImportModalProps {
  readonly open: boolean;
  readonly vaultEntries: SecretEntrySummary[];
  readonly onClose: () => void;
  readonly onAddEntry: (input: SecretEntryInputFull) => Promise<unknown>;
  readonly onImportComplete: (result: ImportExecutionResult) => void;
}

export function ImportModal({
  open,
  vaultEntries,
  onClose,
  onAddEntry,
  onImportComplete,
}: Readonly<ImportModalProps>) {
  const { t } = useTranslation();
  const [step, setStep] = useState<ImportStep>("format");
  const [format, setFormat] = useState<ImportFormat>("bitwarden");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportExecutionResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setStep("format");
    setFormat("bitwarden");
    setFileName(null);
    setParseResult(null);
    setPreview(null);
    setFileError(null);
    setImporting(false);
    setResult(null);
    setResultError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const sampleEntries = useMemo(
    () => parseResult?.entries.slice(0, PREVIEW_SAMPLE_SIZE) ?? [],
    [parseResult],
  );

  const handlePickFile = () => {
    runAsync(async () => {
      setFileError(null);
      const path = await pickImportPath(format);
      if (!path) {
        return;
      }

      const content = await readTextFileViaBackend(path);
      if (!validateImportFormat(content, format)) {
        setFileError(t("import.error_format_mismatch"));
        setFileName(path.split(/[/\\]/).pop() ?? path);
        setParseResult(null);
        setPreview(null);
        return;
      }

      const parsed = parseImportFile(content, format);
      if (parsed.entries.length === 0) {
        setFileError(t("import.error_no_entries"));
        setFileName(path.split(/[/\\]/).pop() ?? path);
        setParseResult(null);
        setPreview(null);
        return;
      }

      const nextPreview = buildImportPreview(parsed, vaultEntries);
      setFileName(path.split(/[/\\]/).pop() ?? path);
      setParseResult(parsed);
      setPreview(nextPreview);
      setFileError(null);
    });
  };

  const handleConfirmImport = () => {
    if (!preview || !parseResult) {
      return;
    }

    setImporting(true);
    setResultError(null);
    runAsync(async () => {
      try {
        const importResult = await executeImport(preview, onAddEntry, parseResult.skippedInvalid);
        setResult(importResult);
        setStep("result");
        onImportComplete(importResult);
      } catch {
        setResultError(t("import.error_import_failed"));
        setStep("result");
      } finally {
        setImporting(false);
      }
    });
  };

  const handleClose = () => {
    if (importing) {
      return;
    }
    onClose();
  };

  const stepTitle = () => {
    if (step === "format") return t("import.step_select_format");
    if (step === "file") return t("import.step_select_file");
    if (step === "confirm") return t("import.step_confirm");
    return t("import.step_result");
  };

  const renderFormatStep = () => (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={t("import.step_select_format")}>
      {IMPORT_FORMATS.map((item) => {
        const optionId = `import-format-option-${item}`;
        const hintId = `import-format-hint-${item}`;
        const optionLabel = t(`import.format_${item}_label`);
        const optionHint = t(`import.format_${item}_hint`);
        const selected = format === item;

        return (
          <label
            key={item}
            htmlFor={optionId}
            aria-label={optionLabel}
            className={formatOptionClass(selected)}
          >
            <input
              id={optionId}
              type="radio"
              name="import-format"
              value={item}
              checked={selected}
              onChange={() => setFormat(item)}
              aria-describedby={hintId}
              className="mt-1 accent-vault-accent"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className={formatLabelClass(selected)}>{optionLabel}</span>
              <span id={hintId} className="text-xs leading-relaxed text-vault-muted">
                {optionHint}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );

  const renderFileStep = () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <VaultButton variant="outline" size="md" onClick={handlePickFile}>
          {t("import.btn_select_file")}
        </VaultButton>
        {fileName ? (
          <div
            className={`${NOTE_PANEL_CLASS} min-w-0 flex-1 truncate rounded-md px-3 py-2 text-xs text-vault-text`}
          >
            {fileName}
          </div>
        ) : null}
      </div>

      {fileError ? (
        <p className="rounded-md border border-vault-danger/40 bg-vault-danger-subtle px-3 py-2 font-mono text-xs text-vault-danger" role="alert">
          {fileError}
        </p>
      ) : null}

      {parseResult && preview ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-sm text-vault-text">
            {highlightNumbers(t("import.preview_found", { count: parseResult.entries.length }))}
          </p>
          <div className="overflow-x-auto rounded-md border border-vault-border bg-vault-bg">
            <table className="w-full min-w-[28rem] border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-vault-border bg-vault-elevated text-left text-vault-muted">
                  <th className="px-3 py-2.5 font-medium">{t("import.preview_col_title")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("import.preview_col_url")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("import.preview_col_username")}</th>
                </tr>
              </thead>
              <tbody>
                {sampleEntries.map((entry, index) => (
                  <tr
                    key={`${entry.title}-${entry.url}-${index}`}
                    className="border-b border-vault-border/60 last:border-b-0"
                  >
                    <td className="max-w-[10rem] truncate px-3 py-2.5 text-vault-text">
                      {entry.title || t("common.dash")}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-vault-muted">
                      {entry.url || t("common.dash")}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2.5 text-vault-muted">
                      {entry.username || t("common.dash")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parseResult.entries.length > PREVIEW_SAMPLE_SIZE ? (
            <p className="font-mono text-[11px] text-vault-muted">
              {highlightNumbers(
                t("import.preview_more", {
                  count: parseResult.entries.length - PREVIEW_SAMPLE_SIZE,
                }),
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderConfirmStep = () => {
    if (!preview || !parseResult) {
      return null;
    }

    return (
      <div className={`${CONFIRM_PANEL_CLASS} flex flex-col gap-3 rounded-md px-4 py-4`}>
        <p className="font-mono text-sm leading-relaxed text-vault-text">
          {highlightNumbers(t("import.confirm_question", { count: preview.importableCount }))}
        </p>
        {preview.duplicateCount > 0 ? (
          <p className="font-mono text-xs leading-relaxed text-vault-muted">
            {highlightNumbers(t("import.confirm_duplicates", { count: preview.duplicateCount }))}
          </p>
        ) : null}
        {parseResult.skippedInvalid > 0 ? (
          <p className="font-mono text-xs leading-relaxed text-vault-muted">
            {highlightNumbers(t("import.confirm_invalid", { count: parseResult.skippedInvalid }))}
          </p>
        ) : null}
      </div>
    );
  };

  const renderResultStep = () => {
    if (resultError) {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <ResultIcon tone="danger" />
          <p
            className="max-w-md font-mono text-sm leading-relaxed text-vault-danger"
            role="alert"
          >
            {resultError}
          </p>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const isPartial =
      result.skippedDuplicates > 0 || result.skippedInvalid > 0 || result.failed > 0;
    const isSuccess = result.imported > 0 && !isPartial;

    if (isSuccess) {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <ResultIcon tone="success" />
          <p className="max-w-md font-mono text-sm leading-relaxed text-vault-text">
            {highlightNumbers(t("import.result_success", { count: result.imported }))}
          </p>
        </div>
      );
    }

    if (result.imported > 0) {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <ResultIcon tone="warning" />
          <p className="max-w-md font-mono text-sm leading-relaxed text-vault-text">
            {highlightNumbers(
              t("import.result_partial", {
                imported: result.imported,
                skipped: result.skippedDuplicates + result.skippedInvalid + result.failed,
              }),
            )}
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <ResultIcon tone="danger" />
        <p className="max-w-md font-mono text-sm leading-relaxed text-vault-danger" role="alert">
          {t("import.result_none")}
        </p>
      </div>
    );
  };

  const canAdvanceFromFile = Boolean(parseResult && preview && !fileError);
  const canConfirm = Boolean(preview && preview.importableCount > 0);

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      ariaLabelledBy={TITLE_ID}
      closeDisabled={importing}
    >
      <div className={panelClass}>
        <header className={headerClass}>
          <h2 id={TITLE_ID} className={`${UI.title} text-base`}>
            {t("import.title")}
          </h2>
          <p className={`${UI.muted} mt-0.5 text-xs`}>{stepTitle()}</p>
        </header>

        <div className={bodyClass}>
          {step === "format" ? renderFormatStep() : null}
          {step === "file" ? renderFileStep() : null}
          {step === "confirm" ? renderConfirmStep() : null}
          {step === "result" ? renderResultStep() : null}
        </div>

        <footer className={footerClass}>
          {step === "format" ? (
            <>
              <VaultButton variant="outline" size="sm" onClick={handleClose}>
                {t("common.cancel")}
              </VaultButton>
              <VaultButton variant="primary" size="sm" onClick={() => setStep("file")}>
                {t("import.btn_next")}
              </VaultButton>
            </>
          ) : null}

          {step === "file" ? (
            <>
              <VaultButton variant="outline" size="sm" onClick={() => setStep("format")}>
                {t("import.btn_back")}
              </VaultButton>
              <VaultButton
                variant="primary"
                size="sm"
                disabled={!canAdvanceFromFile}
                onClick={() => setStep("confirm")}
              >
                {t("import.btn_next")}
              </VaultButton>
            </>
          ) : null}

          {step === "confirm" ? (
            <>
              <VaultButton
                variant="outline"
                size="sm"
                onClick={() => setStep("file")}
                disabled={importing}
              >
                {t("import.btn_back")}
              </VaultButton>
              <VaultButton
                variant="primary"
                size="sm"
                disabled={!canConfirm || importing}
                onClick={handleConfirmImport}
              >
                {importing ? t("common.pleaseWait") : t("import.btn_confirm")}
              </VaultButton>
            </>
          ) : null}

          {step === "result" ? (
            <VaultButton variant="primary" size="sm" onClick={handleClose}>
              {t("common.close")}
            </VaultButton>
          ) : null}
        </footer>
      </div>
    </ModalDialog>
  );
}

type ResultTone = "success" | "warning" | "danger";

const RESULT_GLYPH: Record<ResultTone, string> = {
  success: "✓",
  warning: "!",
  danger: "✕",
};

const RESULT_TONE_CLASS: Record<ResultTone, string> = {
  success: "bg-vault-success-subtle text-vault-success",
  warning: "bg-vault-warning-subtle text-vault-warning",
  danger: "bg-vault-danger-subtle text-vault-danger",
};

const RESULT_RING: Record<ResultTone, string> = {
  success: "var(--color-vault-success)",
  warning: "var(--color-vault-warning)",
  danger: "var(--color-vault-danger)",
};

/** Ergebnis-Status-Badge im Import-Flow (ersetzt farbige Emojis). */
function ResultIcon({ tone }: Readonly<{ tone: ResultTone }>) {
  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-md ${RESULT_TONE_CLASS[tone]}`}
      style={{
        boxShadow: `0 0 0 1px color-mix(in srgb, ${RESULT_RING[tone]} 25%, transparent) inset`,
      }}
    >
      <span className="font-mono text-2xl leading-none" aria-hidden>
        {RESULT_GLYPH[tone]}
      </span>
    </div>
  );
}
