export type ThemeId = "oxid" | "dracula" | "nord" | "matrix";

export const THEME_STORAGE_KEY = "oxidvault-theme";

export const DEFAULT_THEME: ThemeId = "oxid";

export const THEME_IDS: ThemeId[] = ["oxid", "dracula", "nord", "matrix"];

const VALID_THEMES = new Set<string>(THEME_IDS);

export function isThemeId(value: string): value is ThemeId {
  return VALID_THEMES.has(value);
}

export function getStoredTheme(): ThemeId {
  if (globalThis.window === undefined) return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
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
