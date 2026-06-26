// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { formatExpiryDate, getExpiryStatus } from "@/lib/expiry";
import type { SecretEntryPublic } from "@/types/vault";

export function ExpiryBadge({ expiresAt }: Readonly<{ expiresAt?: string | null }>) {
  const { t } = useTranslation();
  const status = getExpiryStatus(expiresAt);
  if (!status || !expiresAt) return null;

  if (status.kind === "expired") {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-vault-danger/50 bg-vault-danger/10 px-2.5 py-1 font-mono text-[11px] text-vault-danger">
        <span aria-hidden>⚠</span>
        {t("expiry.expiredWarning")}
      </div>
    );
  }

  let suffix = "";
  if (status.daysRemaining === 0) {
    suffix = t("expiry.today");
  } else if (status.daysRemaining === 1) {
    suffix = t("expiry.tomorrow");
  }

  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300">
      <span aria-hidden>⏳</span>
      {t("expiry.expiresOn", { date: formatExpiryDate(expiresAt) })}
      {suffix}
    </div>
  );
}

export function expiryLabel(entry: Pick<SecretEntryPublic, "expires_at">): string | null {
  const status = getExpiryStatus(entry.expires_at);
  if (!status || !entry.expires_at) return null;
  if (status.kind === "expired") {
    return i18n.t("expiry.expired");
  }
  return i18n.t("expiry.expiresOn", { date: formatExpiryDate(entry.expires_at) });
}
