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
      <div
        className="flex h-14 w-14 items-center justify-center rounded-md bg-vault-accent-subtle text-vault-accent"
        style={{
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--color-vault-accent) 20%, transparent) inset",
        }}
      >
        <LockIcon locked className="h-6 w-6" />
      </div>
      <h2
        className="mt-6 text-base font-bold text-vault-text"
        style={{ letterSpacing: "-0.02em" }}
      >
        {t("settings.lockedTitle")}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-vault-muted">
        {t("settings.lockedHint")}
      </p>
      <VaultButton variant="primary" size="sm" className="mt-6" onClick={onGoToUnlock}>
        {t("settings.goToUnlock")}
      </VaultButton>
    </div>
  );
}
