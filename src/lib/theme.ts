// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export type ThemeId = "oxid" | "oxid-light" | "dracula" | "nord";

export const THEME_STORAGE_KEY = "oxidvault-theme";

export const DEFAULT_THEME: ThemeId = "oxid-light";

export const THEME_IDS: ThemeId[] = ["oxid", "oxid-light", "dracula", "nord"];

const VALID_THEMES = new Set<string>(THEME_IDS);

export function isThemeId(value: string): value is ThemeId {
  return VALID_THEMES.has(value);
}

export function getStoredTheme(): ThemeId {
  if (globalThis.window === undefined) return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "matrix") {
      return DEFAULT_THEME;
    }
    if (stored && isThemeId(stored)) return stored;
  } catch {
    /* private browsing / blocked storage */
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Call before React mount to avoid theme flash on load. */
export function initTheme(): ThemeId {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}

/** @deprecated Use THEME_IDS with i18n `theme.{id}.label` */
export const THEME_OPTIONS = THEME_IDS.map((id) => ({ id, label: id, description: "" }));
