// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { generatePassword } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";
import { INPUT_FIELD_CLASS, MODAL_FOOTER_CLASS, MODAL_PANEL_CLASS } from "@/lib/uiClasses";
import type { PasswordGenOptions } from "@/types/vault";
import { DEFAULT_PASSWORD_LENGTH } from "@/types/vault";

interface PasswordGeneratorModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApply?: (password: string) => void;
}

const DEFAULT_OPTIONS: PasswordGenOptions = {
  length: DEFAULT_PASSWORD_LENGTH,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
};

function copyButtonLabel(
  copied: boolean,
  hasApply: boolean,
  translate: (key: string) => string,
): string {
  if (copied) {
    return hasApply ? translate("passwordGen.applied") : translate("passwordGen.copied");
  }
  if (hasApply) {
    return translate("passwordGen.apply");
  }
  return translate("passwordGen.copy");
}

export function PasswordGeneratorModal({
  open,
  onClose,
  onApply,
}: Readonly<PasswordGeneratorModalProps>) {
  const { t } = useTranslation();
  const lengthSliderId = useId();
  const [options, setOptions] = useState<PasswordGenOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runGenerate = useCallback(async (opts: PasswordGenOptions) => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const pwd = await generatePassword(opts);
      setPassword(pwd);
    } catch (e) {
      setError(String(e));
      setPassword("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setOptions(DEFAULT_OPTIONS);
      setCopied(false);
      setError(null);
      runAsync(() => runGenerate(DEFAULT_OPTIONS));
    }
  }, [open, runGenerate]);

  const hasCharset =
    options.uppercase || options.lowercase || options.digits || options.symbols;

  const handleOptionChange = (patch: Partial<PasswordGenOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    runAsync(() => runGenerate(next));
  };

  const handleCopy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      if (onApply) {
        onApply(password);
      }
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("passwordGen.clipboardUnavailable"));
    }
  };

  const handleRegenerate = () => {
    runAsync(() => runGenerate(options));
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy="password-gen-title"
      closeDisabled={loading}
    >
      <div className={`${MODAL_PANEL_CLASS} max-w-md`}>
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="password-gen-title" className="font-mono text-sm font-semibold">
            {t("passwordGen.title")}
          </h2>
          <p className="mt-1 text-xs text-vault-muted">{t("passwordGen.subtitle")}</p>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label
              htmlFor={lengthSliderId}
              className="mb-1 block font-mono text-[11px] text-vault-muted"
            >
              {t("passwordGen.length", { length: options.length })}
            </label>
            <input
              id={lengthSliderId}
              type="range"
              min={8}
              max={128}
              value={options.length}
              onChange={(e) =>
                handleOptionChange({ length: Number(e.target.value) })
              }
              className="w-full accent-vault-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <CharsetCheckbox
              label={t("passwordGen.uppercase")}
              checked={options.uppercase}
              onChange={(v) => handleOptionChange({ uppercase: v })}
            />
            <CharsetCheckbox
              label={t("passwordGen.lowercase")}
              checked={options.lowercase}
              onChange={(v) => handleOptionChange({ lowercase: v })}
            />
            <CharsetCheckbox
              label={t("passwordGen.digits")}
              checked={options.digits}
              onChange={(v) => handleOptionChange({ digits: v })}
            />
            <CharsetCheckbox
              label={t("passwordGen.symbols")}
              checked={options.symbols}
              onChange={(v) => handleOptionChange({ symbols: v })}
            />
          </div>

          <div className="relative">
            <input
              readOnly
              value={password}
              className={`${INPUT_FIELD_CLASS} pr-20 text-xs tracking-wide`}
              aria-label={t("passwordGen.generatedPassword")}
            />
            <button
              type="button"
              onClick={() => runAsync(handleCopy)}
              disabled={!password}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-vault-border px-2 py-0.5 font-mono text-[10px] text-vault-muted hover:border-vault-accent hover:text-vault-text disabled:opacity-40"
            >
              {copyButtonLabel(copied, Boolean(onApply), t)}
            </button>
          </div>

          {error && (
            <p className="font-mono text-xs text-vault-danger">{error}</p>
          )}
          {!hasCharset && (
            <p className="font-mono text-xs text-vault-danger">
              {t("passwordGen.charsetRequired")}
            </p>
          )}
        </div>

        <footer className={MODAL_FOOTER_CLASS}>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={loading || !hasCharset}
            className="flex-1 rounded bg-vault-accent py-2 font-mono text-xs text-vault-on-accent hover:bg-vault-accent-hover disabled:opacity-50"
          >
            {loading ? t("passwordGen.generating") : t("passwordGen.regenerate")}
          </button>
          {onApply && (
            <button
              type="button"
              onClick={() => {
                if (password) {
                  onApply(password);
                  onClose();
                }
              }}
              disabled={!password}
              className="rounded border border-vault-accent px-4 py-2 font-mono text-xs text-vault-accent hover:bg-vault-accent/10 disabled:opacity-50"
            >
              {t("passwordGen.apply")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-vault-border px-4 py-2 font-mono text-xs text-vault-muted hover:text-vault-text"
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </ModalDialog>
  );
}

function CharsetCheckbox({
  label,
  checked,
  onChange,
}: Readonly<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}>) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-vault-border px-2 py-1.5 font-mono text-[10px] text-vault-muted hover:border-vault-accent/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-vault-accent"
      />
      {label}
    </label>
  );
}
