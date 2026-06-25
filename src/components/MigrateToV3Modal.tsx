// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { MODAL_PANEL_CLASS, NOTE_PANEL_CLASS } from "@/lib/uiClasses";

const MIGRATE_TITLE_ID = "migrate-v3-title";

const panelClass = `${MODAL_PANEL_CLASS} w-full max-w-md space-y-4`;
const noteClass = `${NOTE_PANEL_CLASS} px-3 py-2 font-mono text-xs leading-relaxed`;
const inputClass =
  "w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm";
const titleClass = "font-mono text-sm font-semibold text-vault-text";
const descriptionClass = "font-mono text-xs leading-relaxed text-vault-muted";
const labelClass = "font-mono text-xs text-vault-muted";

interface MigrateToV3ModalProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onMigrate: (adminUsername: string, currentPassword: string) => void;
}

export function MigrateToV3Modal({
  open,
  loading,
  onClose,
  onMigrate,
}: Readonly<MigrateToV3ModalProps>) {
  const { t } = useTranslation();
  const [adminUsername, setAdminUsername] = useState("admin");
  const [currentPassword, setCurrentPassword] = useState("");

  const canSubmit =
    !loading &&
    adminUsername.trim().length > 0 &&
    currentPassword.length > 0;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={MIGRATE_TITLE_ID}
      closeDisabled={loading}
    >
      <div className={panelClass}>
        <h2 id={MIGRATE_TITLE_ID} className={titleClass}>
          {t("users.migrateTitle")}
        </h2>
        <p className={descriptionClass}>{t("users.migrateDescription")}</p>
        <p className={noteClass}>{t("users.migrateWarning")}</p>
        <label className="block space-y-1">
          <span className={labelClass}>{t("users.username")}</span>
          <input
            type="text"
            value={adminUsername}
            onChange={(e) => setAdminUsername(e.target.value)}
            className={inputClass}
          />
        </label>
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
        <div className="flex justify-end gap-2 pt-2">
          <VaultButton variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </VaultButton>
          <VaultButton
            variant="primary"
            size="sm"
            onClick={() => onMigrate(adminUsername.trim(), currentPassword)}
            disabled={!canSubmit}
          >
            {loading ? t("common.pleaseWait") : t("users.migrateNow")}
          </VaultButton>
        </div>
      </div>
    </ModalDialog>
  );
}
