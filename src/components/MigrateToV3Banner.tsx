// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { VaultButton } from "@/components/ui/VaultButton";
import { NOTE_PANEL_CLASS } from "@/lib/uiClasses";

const bannerClass = `${NOTE_PANEL_CLASS} mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3`;
const messageClass = "font-mono text-xs leading-relaxed text-vault-text";

interface MigrateToV3BannerProps {
  readonly onMigrate: () => void;
  readonly onDismiss: () => void;
}

export function MigrateToV3Banner({ onMigrate, onDismiss }: Readonly<MigrateToV3BannerProps>) {
  const { t } = useTranslation();

  return (
    <div className={bannerClass} role="note">
      <p className={messageClass}>{t("users.migrationBanner")}</p>
      <div className="flex shrink-0 gap-2">
        <VaultButton variant="ghost" size="sm" onClick={onDismiss}>
          {t("users.migrateLater")}
        </VaultButton>
        <VaultButton variant="primary" size="sm" onClick={onMigrate}>
          {t("users.migrateNow")}
        </VaultButton>
      </div>
    </div>
  );
}
