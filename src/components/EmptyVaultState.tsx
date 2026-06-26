// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

const containerClass =
  "flex h-full flex-col items-center justify-center gap-6 p-8 text-center";
const iconWrapClass =
  "vault-elevated flex h-16 w-16 items-center justify-center rounded-2xl border border-vault-border bg-vault-surface/30";
const iconClass = "h-8 w-8 text-vault-muted";
const titleClass = "font-mono text-lg font-semibold text-vault-text";
const descriptionClass = "max-w-sm font-mono text-sm text-vault-muted";
const textBlockClass = "flex flex-col gap-2";
const ctaClass =
  "rounded bg-vault-accent px-4 py-2 font-mono text-sm text-vault-on-accent transition-opacity hover:opacity-90";
const hintsClass = "flex flex-col gap-1 font-mono text-xs text-vault-muted";

interface EmptyVaultStateProps {
  readonly onCreateEntry: () => void;
}

export function EmptyVaultState({ onCreateEntry }: Readonly<EmptyVaultStateProps>) {
  const { t } = useTranslation();

  return (
    <div className={containerClass}>
      <div className={iconWrapClass}>
        <Lock className={iconClass} aria-hidden />
      </div>
      <div className={textBlockClass}>
        <h2 className={titleClass}>{t("emptyState.title")}</h2>
        <p className={descriptionClass}>{t("emptyState.description")}</p>
      </div>
      <button type="button" onClick={onCreateEntry} className={ctaClass}>
        {t("emptyState.createFirst")}
      </button>
      <div className={hintsClass}>
        <span>{t("emptyState.hint1")}</span>
        <span>{t("emptyState.hint2")}</span>
      </div>
    </div>
  );
}
