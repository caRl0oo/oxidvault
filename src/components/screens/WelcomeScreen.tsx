// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
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
  return (
    <section className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex flex-col items-center space-y-3">
          <AppLogo size="lg" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{t("common.appName")}</h1>
            <p className="text-sm text-vault-muted">
              {t("welcome.tagline")}{" "}
              <span className="font-mono text-vault-text">{backendStatus}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCreate}
            className="rounded bg-vault-accent py-2.5 text-sm font-medium text-vault-on-accent hover:bg-vault-accent-hover"
          >
            {t("welcome.createVault")}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="rounded border border-vault-border py-2.5 text-sm text-vault-muted hover:border-vault-accent hover:text-vault-text"
          >
            {t("welcome.openVault")}
          </button>
        </div>
        <p className="font-mono text-[11px] text-vault-muted">{t("common.cryptoHint")}</p>
      </div>
    </section>
  );
}
