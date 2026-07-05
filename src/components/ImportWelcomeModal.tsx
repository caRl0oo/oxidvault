// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { VaultButton } from "@/components/ui/VaultButton";
import { MODAL_FOOTER_CLASS, MODAL_PANEL_CLASS, UI } from "@/lib/uiClasses";

const TITLE_ID = "import-welcome-title";

const panelClass = `${MODAL_PANEL_CLASS} w-full max-w-md overflow-hidden rounded-lg border-vault-border bg-vault-elevated p-0 [box-shadow:var(--shadow-lg)]`;

interface ImportWelcomeModalProps {
  readonly open: boolean;
  readonly onImport: () => void;
  readonly onStartFresh: () => void;
}

export function ImportWelcomeModal({
  open,
  onImport,
  onStartFresh,
}: Readonly<ImportWelcomeModalProps>) {
  const { t } = useTranslation();

  return (
    <ModalDialog open={open} onClose={onStartFresh} ariaLabelledBy={TITLE_ID}>
      <div className={panelClass}>
        <div className="flex flex-col items-center gap-4 px-8 pb-6 pt-8 text-center">
          <AppLogo size="lg" className="rounded-lg shadow-md" />
          <div className="flex flex-col gap-2">
            <h2 id={TITLE_ID} className={`${UI.title} text-lg`}>
              {t("import.welcome_title")}
            </h2>
            <p className={`${UI.muted} max-w-sm text-sm leading-relaxed`}>
              {t("import.welcome_body")}
            </p>
          </div>
        </div>

        <footer className={`${MODAL_FOOTER_CLASS} justify-end bg-vault-bg/40 px-6`}>
          <VaultButton variant="outline" size="sm" onClick={onStartFresh}>
            {t("import.btn_skip")}
          </VaultButton>
          <VaultButton variant="primary" size="sm" onClick={onImport}>
            {t("import.btn_import")}
          </VaultButton>
        </footer>
      </div>
    </ModalDialog>
  );
}
