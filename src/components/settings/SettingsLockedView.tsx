// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { LockIcon } from "@/components/ui/LockIcon";
import { VaultButton } from "@/components/ui/VaultButton";

interface SettingsLockedViewProps {
  readonly onGoToUnlock: () => void;
}

export function SettingsLockedView({ onGoToUnlock }: Readonly<SettingsLockedViewProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex max-w-md flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full border border-vault-border bg-vault-surface/60 p-4 text-vault-muted">
        <LockIcon locked className="h-8 w-8" />
      </div>
      <h2 className="mt-6 font-mono text-sm text-vault-text">{t("settings.lockedTitle")}</h2>
      <p className="mt-2 font-mono text-xs leading-relaxed text-vault-muted">
        {t("settings.lockedHint")}
      </p>
      <VaultButton variant="primary" size="sm" className="mt-6" onClick={onGoToUnlock}>
        {t("settings.goToUnlock")}
      </VaultButton>
    </div>
  );
}
