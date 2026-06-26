// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { MODAL_FOOTER_CLASS, MODAL_PANEL_CLASS } from "@/lib/uiClasses";

interface DeleteConfirmationModalProps {
  readonly open: boolean;
  readonly entryTitle: string;
  readonly loading?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function DeleteConfirmationModal({
  open,
  entryTitle,
  loading = false,
  onClose,
  onConfirm,
}: Readonly<DeleteConfirmationModalProps>) {
  const { t } = useTranslation();

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      ariaLabelledBy="delete-entry-title"
      closeDisabled={loading}
    >
      <div className={`${MODAL_PANEL_CLASS} max-w-md`}>
        <header className="border-b border-vault-border px-5 py-4">
          <h2 id="delete-entry-title" className="font-mono text-sm font-semibold text-vault-danger">
            {t("entry.deleteConfirmTitle")}
          </h2>
          <p className="mt-2 font-mono text-xs leading-relaxed text-vault-muted">
            {t("entry.deleteConfirmBody", { title: entryTitle })}
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-vault-muted">
            {t("entry.deleteConfirmHardDeleteHint")}
          </p>
        </header>

        <footer className={MODAL_FOOTER_CLASS}>
          <VaultButton
            variant="ghost"
            fullWidth
            onClick={onClose}
            disabled={loading}
          >
            {t("common.cancel")}
          </VaultButton>
          <VaultButton
            variant="outline"
            tone="danger"
            fullWidth
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t("entry.deleteInProgress") : t("entry.deleteConfirmAction")}
          </VaultButton>
        </footer>
      </div>
    </ModalDialog>
  );
}
