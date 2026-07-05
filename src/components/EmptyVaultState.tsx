// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { UI } from "@/lib/uiClasses";

interface EmptyVaultStateProps {
  readonly onCreateEntry: () => void;
}

export function EmptyVaultState({ onCreateEntry }: Readonly<EmptyVaultStateProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-md bg-vault-accent-subtle text-vault-accent"
          style={{
            boxShadow:
              "0 0 0 1px color-mix(in srgb, var(--color-vault-accent) 20%, transparent) inset",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2
            className="text-base font-bold text-vault-text"
            style={{ letterSpacing: "-0.02em" }}
          >
            {t("emptyState.title")}
          </h2>
          <p className="max-w-xs text-sm text-vault-muted">{t("emptyState.description")}</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button type="button" onClick={onCreateEntry} className={`${UI.btnPrimary} px-5 py-2`}>
          {t("emptyState.createFirst")}
        </button>
        <div className="flex flex-col gap-1 font-mono text-[11px] text-vault-muted">
          <span>{t("emptyState.hint1")}</span>
          <span>{t("emptyState.hint2")}</span>
        </div>
      </div>
    </div>
  );
}
