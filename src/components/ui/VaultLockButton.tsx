// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { LockIcon } from "@/components/ui/LockIcon";

interface VaultLockButtonProps {
  readonly locked: boolean;
  readonly onLock: () => void;
}

export function VaultLockButton({ locked, onLock }: Readonly<VaultLockButtonProps>) {
  const { t } = useTranslation();

  const toneClass = locked
    ? "cursor-default border-vault-border text-vault-danger"
    : "border-vault-border text-vault-success hover:border-vault-accent hover:text-vault-accent";

  return (
    <button
      type="button"
      onClick={onLock}
      disabled={locked}
      aria-label={t("app.lockVaultAria")}
      title={locked ? t("app.statusLocked") : t("vault.lockVault")}
      className={`rounded border p-1.5 transition disabled:opacity-80 ${toneClass}`}
    >
      <LockIcon locked={locked} className="h-4 w-4" />
    </button>
  );
}
