// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { STATUS_SUCCESS_CLASS } from "@/lib/uiClasses";
import { changeUserPassword } from "@/lib/ipc";
import { formatVaultError } from "@/lib/errors";

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
    <div className="vault-card mt-4 flex flex-col gap-4">
      <div className="vault-section-label">{t("users.changePassword")}</div>

      <div className="flex flex-col gap-1.5">
        <label className="vault-field-label" htmlFor="change-user-password-current">
          {t("users.currentPassword")}
        </label>
        <input
          id="change-user-password-current"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className="vault-input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="vault-field-label" htmlFor="change-user-password-new">
          {t("users.newPassword")}
        </label>
        <MasterPasswordInput
          id="change-user-password-new"
          value={newPassword}
          onChange={setNewPassword}
          placeholder={t("users.newPassword")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="vault-field-label" htmlFor="change-user-password-confirm">
          {t("users.confirmPassword")}
        </label>
        <input
          id="change-user-password-confirm"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className="vault-input"
        />
      </div>

      {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
        <p className="text-xs text-vault-danger">{t("users.passwordMismatch")}</p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit}
        className="vault-btn-primary self-start px-4 py-2 text-sm disabled:opacity-50"
      >
        {loading ? t("common.pleaseWait") : t("users.changePassword")}
      </button>

      {success ? <p className={`${STATUS_SUCCESS_CLASS} text-xs`}>{t("users.changePasswordSuccess")}</p> : null}
      {error ? (
        <p className="text-xs text-vault-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
