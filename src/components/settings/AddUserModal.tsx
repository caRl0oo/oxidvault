// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterPasswordInput, evaluateMasterPassword } from "@/components/MasterPasswordInput";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { MODAL_PANEL_CLASS } from "@/lib/uiClasses";
import type { UserRole } from "@/types/vault";

const ADD_USER_TITLE_ID = "add-user-title";

const panelClass = `${MODAL_PANEL_CLASS} w-full max-w-md space-y-4`;
const titleClass = "font-mono text-sm font-semibold text-vault-text";
const labelClass = "font-mono text-xs text-vault-muted";
const inputClass =
  "w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm";
const mismatchClass = "font-mono text-xs text-vault-danger";

interface AddUserModalProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (username: string, password: string, role: UserRole) => void;
}

export function AddUserModal({
  open,
  loading,
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
        <label className="block space-y-1">
          <span className={labelClass}>{t("users.username")}</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
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
