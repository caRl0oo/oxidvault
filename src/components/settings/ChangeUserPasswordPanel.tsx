// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { VaultButton } from "@/components/ui/VaultButton";
import { STATUS_SUCCESS_CLASS } from "@/lib/uiClasses";
import { changeUserPassword } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";

const sectionClass = "space-y-3 border-t border-vault-border/60 pt-6";
const headingClass = "font-mono text-xs uppercase tracking-wider text-vault-muted";
const labelClass = "font-mono text-xs text-vault-muted";
const inputClass =
  "w-full max-w-xl rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm";
const mismatchClass = "font-mono text-xs text-vault-danger";
const errorClass = "font-mono text-xs text-vault-danger";
const successClass = `${STATUS_SUCCESS_CLASS} px-3 py-2 text-xs`;

export function ChangeUserPasswordPanel() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const newValid = evaluateMasterPassword(newPassword).valid;
  const canSubmit =
    !loading &&
    currentPassword.length > 0 &&
    newValid &&
    newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      globalThis.setTimeout(() => setSuccess(false), 4000);
    } catch (e) {
      setError(formatVaultError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={sectionClass}>
      <h2 className={headingClass}>{t("users.changePassword")}</h2>
      <label className="block space-y-1">
        <span className={labelClass}>{t("users.currentPassword")}</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      <div className="max-w-xl">
        <MasterPasswordInput
          value={newPassword}
          onChange={setNewPassword}
          placeholder={t("users.newPassword")}
        />
      </div>
      <label className="block space-y-1">
        <span className={labelClass}>{t("users.confirmPassword")}</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
        <p className={mismatchClass}>{t("users.passwordMismatch")}</p>
      ) : null}
      <VaultButton
        variant="primary"
        size="sm"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit}
      >
        {loading ? t("common.pleaseWait") : t("users.changePassword")}
      </VaultButton>
      {success ? <p className={successClass}>{t("users.changePasswordSuccess")}</p> : null}
      {error ? (
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
