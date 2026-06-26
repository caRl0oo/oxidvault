// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { OverlayModal } from "@/components/ui/OverlayModal";
import { enableMFA, verifyMFACode } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";
import { INPUT_FIELD_CLASS, MODAL_FOOTER_CLASS } from "@/lib/uiClasses";
import type { MfaSetupInfo } from "@/types/mfa";

interface MfaSetupModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onVerified?: () => void;
}

const CODE_LENGTH = 6;

function renderQrPanel(
  loadingSetup: boolean,
  setupInfo: MfaSetupInfo | null,
  t: (key: string) => string,
) {
  if (loadingSetup) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
        {t("settings.mfa.qrLoading")}
      </span>
    );
  }

  if (setupInfo?.qrCodePngBase64) {
    return (
      <img
        src={`data:image/png;base64,${setupInfo.qrCodePngBase64}`}
        alt={t("settings.mfa.qrAlt")}
        className="h-full w-full object-contain"
      />
    );
  }

  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
      {t("settings.mfa.qrPlaceholder")}
    </span>
  );
}

export function MfaSetupModal({ open, onClose, onVerified }: Readonly<MfaSetupModalProps>) {
  const { t } = useTranslation();
  const titleId = useId();
  const codeInputId = useId();

  const [setupInfo, setSetupInfo] = useState<MfaSetupInfo | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSetup = useCallback(async () => {
    setLoadingSetup(true);
    setError(null);
    setCode("");
    try {
      const info = await enableMFA();
      setSetupInfo(info);
    } catch (e) {
      setSetupInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSetup(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      runAsync(loadSetup);
    }
  }, [open, loadSetup]);

  const handleCodeChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digitsOnly);
    setError(null);
  };

  const handleVerify = async () => {
    if (code.length !== CODE_LENGTH) {
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const valid = await verifyMFACode(code);
      if (!valid) {
        setError(t("settings.mfa.invalidCode"));
        return;
      }
      onVerified?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  };

  const canVerify = code.length === CODE_LENGTH && !verifying && !loadingSetup;

  return (
    <OverlayModal
      open={open}
      onClose={onClose}
      ariaLabel={t("settings.mfa.modalTitle")}
      ariaLabelledBy={titleId}
      closeLabel={t("common.closeDialog")}
      panelClassName="max-w-md"
    >
      <header className="flex items-start justify-between gap-3 border-b border-vault-border px-5 py-4">
        <h2 id={titleId} className="font-mono text-sm font-semibold text-vault-text">
          {t("settings.mfa.modalTitle")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.closeDialog")}
          className="rounded border border-transparent px-1.5 py-0.5 font-mono text-sm leading-none text-vault-muted transition hover:border-vault-border hover:text-vault-text"
        >
          ×
        </button>
      </header>

      <div className="space-y-4 px-5 py-5">
        <p className="font-mono text-xs leading-relaxed text-vault-muted">
          {t("settings.mfa.modalHint")}
        </p>

        <div className="flex flex-col items-center gap-3">
          <div className="flex h-44 w-44 items-center justify-center rounded-lg border border-vault-border bg-vault-bg p-2">
            {renderQrPanel(loadingSetup, setupInfo, t)}
          </div>
          {setupInfo && (
            <p className="font-mono text-[10px] text-vault-muted">{setupInfo.accountLabel}</p>
          )}
        </div>

        <label htmlFor={codeInputId} className="block">
          <span className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
            {t("settings.mfa.codeLabel")}
          </span>
          <input
            id={codeInputId}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder={t("settings.mfa.codePlaceholder")}
            className={`${INPUT_FIELD_CLASS} mt-2 text-center tracking-[0.35em]`}
          />
        </label>

        {error && (
          <p className="font-mono text-[11px] text-vault-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className={MODAL_FOOTER_CLASS}>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded border border-vault-border px-3 py-2 font-mono text-xs text-vault-muted transition hover:text-vault-text"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => runAsync(handleVerify)}
          disabled={!canVerify}
          className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-vault-on-accent transition hover:bg-vault-accent-hover disabled:opacity-50"
        >
          {verifying ? t("settings.mfa.verifying") : t("settings.mfa.verify")}
        </button>
      </footer>
    </OverlayModal>
  );
}
