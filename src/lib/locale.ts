// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export type LocaleId = "de" | "en";

export const LOCALE_STORAGE_KEY = "oxidvault-locale";

export const DEFAULT_LOCALE: LocaleId = "de";

export interface LocaleOption {
  id: LocaleId;
  label: string;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { id: "de", label: "Deutsch" },
  { id: "en", label: "English" },
];

const VALID_LOCALES = new Set<string>(LOCALE_OPTIONS.map((option) => option.id));

export function isLocaleId(value: string): value is LocaleId {
  return VALID_LOCALES.has(value);
}

export function getStoredLocale(): LocaleId {
  if (globalThis.localStorage === undefined) {
    return DEFAULT_LOCALE;
  }
  try {
    const stored = globalThis.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isLocaleId(stored)) {
      return stored;
    }
  } catch {
    /* private browsing / blocked storage */
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: LocaleId): void {
  try {
    globalThis.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
