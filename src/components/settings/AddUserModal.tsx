// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { CONFIRM_PANEL_CLASS, MODAL_PANEL_CLASS, UI } from "@/lib/uiClasses";
import { openWebsiteUrl } from "@/lib/openWebsite";
import { runAsync } from "@/lib/runAsync";
import type { UserRole } from "@/types/vault";

const ADD_USER_TITLE_ID = "add-user-title";
const UPGRADE_URL = "https://oxidvault.de";

const panelClass = `${MODAL_PANEL_CLASS} w-full max-w-md space-y-4`;
const titleClass = "font-mono text-sm font-semibold text-vault-text";
const labelClass = UI.fieldLabel;
const inputClass = UI.input;
const mismatchClass = "font-mono text-xs text-vault-danger";
const licenseBannerClass = `${CONFIRM_PANEL_CLASS} space-y-2 p-4`;
const licenseTitleClass = "font-mono text-sm font-semibold text-vault-text";
const licenseBodyClass = "font-mono text-xs leading-relaxed text-vault-muted";

interface AddUserModalProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly licenseLimitReached: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (username: string, password: string, role: UserRole) => void;
}

export function AddUserModal({
  open,
  loading,
  licenseLimitReached,
  onClose,
  onSubmit,
}: Readonly<AddUserModalProps>) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");

  const passwordValid = evaluateMasterPassword(password).valid;
  const canSubmit =
    !loading &&
    !licenseLimitReached &&
    username.trim().length > 0 &&
    passwordValid &&
    password === confirmPassword;

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(username.trim(), password, role);
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={ADD_USER_TITLE_ID}
      closeDisabled={loading}
    >
      <div className={panelClass}>
        <h2 id={ADD_USER_TITLE_ID} className={titleClass}>
          {t("users.addUserTitle")}
        </h2>
        {licenseLimitReached ? (
          <div className={licenseBannerClass}>
            <p className={licenseTitleClass}>{t("license.limitReached")}</p>
            <p className={licenseBodyClass}>{t("license.limitDescription")}</p>
            <p className={licenseBodyClass}>{t("license.upgradePrompt")}</p>
            <VaultButton
              variant="outline"
              size="sm"
              onClick={() => runAsync(() => openWebsiteUrl(UPGRADE_URL))}
            >
              {t("license.upgradeRequestButton")}
            </VaultButton>
            <p className="font-mono text-[10px] text-vault-muted">oxidvault.de</p>
          </div>
        ) : null}
        <label className="block space-y-1">
          <span className={labelClass}>{t("users.username")}</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            disabled={licenseLimitReached}
          />
        </label>
        <MasterPasswordInput value={password} onChange={setPassword} />
        <label className="block space-y-1">
          <span className={labelClass}>{t("users.confirmPassword")}</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            disabled={licenseLimitReached}
          />
        </label>
        {confirmPassword.length > 0 && password !== confirmPassword ? (
          <p className={mismatchClass}>{t("users.passwordMismatch")}</p>
        ) : null}
        <label className="block space-y-1">
          <span className={labelClass}>{t("users.role")}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className={inputClass}
            disabled={licenseLimitReached}
          >
            <option value="member">{t("users.roleMember")}</option>
            <option value="admin">{t("users.roleAdmin")}</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <VaultButton variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </VaultButton>
          <VaultButton variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? t("common.pleaseWait") : t("users.addUserSubmit")}
          </VaultButton>
        </div>
      </div>
    </ModalDialog>
  );
}
