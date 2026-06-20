export type ThemeId = "oxid" | "dracula" | "nord" | "matrix";

export const THEME_STORAGE_KEY = "oxidvault-theme";

export const DEFAULT_THEME: ThemeId = "oxid";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "oxid", label: "Oxid Default", description: "Klassisches Dunkelblau" },
  { id: "dracula", label: "Dracula", description: "Dunkles Violett & Purpur" },
  { id: "nord", label: "Nord Arctic", description: "Eisiges Blaugrau" },
  { id: "matrix", label: "Matrix Green", description: "Neon-Grün Hacker-Look" },
];

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((t) => t.id));

export function isThemeId(value: string): value is ThemeId {
  return VALID_THEMES.has(value);
}

export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isThemeId(stored)) return stored;
  } catch {
    /* private browsing / blocked storage */
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
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
