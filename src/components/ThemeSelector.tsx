// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GearIcon } from "@/components/ui/GearIcon";
import { ThemeSwatch } from "@/components/ui/ThemeSwatch";
import { useTheme } from "@/hooks/useTheme";
import { THEME_IDS } from "@/lib/theme";

export function ThemeSelector() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("theme.selectAria")}
        title={t("theme.selectTitle")}
        className="rounded border border-vault-border p-1.5 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent"
      >
        <GearIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          aria-label={t("theme.listAria")}
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl"
        >
          <div className="border-b border-vault-border px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("settings.theme")}
            </p>
            <p className="mt-0.5 font-mono text-xs text-vault-text">
              {t(`theme.${theme}.label`)}
            </p>
          </div>
          <ul className="py-1">
            {THEME_IDS.map((themeId) => {
              const active = themeId === theme;
              return (
                <li key={themeId}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setTheme(themeId);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col px-3 py-2 text-left transition ${
                      active
                        ? "bg-vault-accent/15 text-vault-text"
                        : "text-vault-muted hover:bg-vault-border/40 hover:text-vault-text"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-mono text-xs font-medium">
                      <ThemeSwatch themeId={themeId} />
                      {t(`theme.${themeId}.label`)}
                      {active && (
                        <span className="ml-auto text-[10px] text-vault-accent">✓</span>
                      )}
                    </span>
                    <span className="mt-0.5 pl-5 font-mono text-[10px] opacity-70">
                      {t(`theme.${themeId}.description`)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
