// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { AppLogo } from "@/components/AppLogo";

interface WelcomeScreenProps {
  readonly onCreate: () => void;
  readonly onOpen: () => void;
  readonly backendStatus: string;
}

export function WelcomeScreen({ onCreate, onOpen, backendStatus }: Readonly<WelcomeScreenProps>) {
  const { t } = useTranslation();
  const isLoading = backendStatus === t("common.loading");

  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <AppLogo size="lg" />
          <div className="flex flex-col gap-1.5">
            <h1
              className="text-lg font-bold text-vault-text"
              style={{ letterSpacing: "-0.02em" }}
            >
              {t("common.appName")}
            </h1>
            <p className="text-sm text-vault-muted">{t("welcome.tagline")}</p>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-vault-muted">
            {isLoading ? (
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-vault-accent"
                aria-hidden
              />
            ) : (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-vault-success"
                aria-hidden
              />
            )}
            <span>{backendStatus}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCreate}
            disabled={isLoading}
            className="rounded bg-vault-accent py-2.5 text-sm font-medium text-vault-on-accent transition-all duration-150 hover:bg-vault-accent-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("welcome.createVault")}
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={isLoading}
            className="rounded border border-vault-border py-2.5 text-sm text-vault-muted transition-all duration-150 hover:border-vault-accent hover:text-vault-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("welcome.openVault")}
          </button>
        </div>

        <p className="font-mono text-[11px] text-vault-muted">{t("common.cryptoHint")}</p>
      </div>
    </section>
  );
}
