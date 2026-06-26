// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { GearIcon } from "@/components/ui/GearIcon";

interface SettingsGearButtonProps {
  readonly onClick: () => void;
}

export function SettingsGearButton({ onClick }: Readonly<SettingsGearButtonProps>) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("settings.title")}
      title={t("settings.title")}
      className="rounded border border-vault-border p-1.5 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent"
    >
      <GearIcon className="h-4 w-4" />
    </button>
  );
}
