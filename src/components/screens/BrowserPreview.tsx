// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";

export function BrowserPreview() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-lg font-semibold">{t("browserPreview.title")}</h1>
        <p className="text-sm text-vault-muted">
          {t("browserPreview.hint")}{" "}
          <code className="rounded bg-vault-surface px-1 font-mono text-xs">npm run tauri:dev</code>
          {"."}
        </p>
      </div>
    </section>
  );
}
