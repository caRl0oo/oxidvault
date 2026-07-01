// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { getAppSettings, isTauri, markImportOffered } from "@/lib/ipc";
import type { AppSettings } from "@/types/settings";

const LEGACY_STORAGE_PREFIX = "oxidvault-import-offered:";

export function isImportOfferedForPath(
  importOfferedPaths: readonly string[],
  vaultPath: string,
): boolean {
  return importOfferedPaths.includes(vaultPath);
}

export function isImportOfferedInSettings(
  settings: AppSettings,
  vaultPath: string,
): boolean {
  return isImportOfferedForPath(settings.importOfferedPaths ?? [], vaultPath);
}

export async function persistImportOffered(vaultPath: string): Promise<string[]> {
  const settings = await markImportOffered(vaultPath);
  return settings.importOfferedPaths ?? [];
}

export async function migrateLegacyImportOffered(): Promise<string[] | null> {
  if (!isTauri()) {
    return null;
  }

  const legacyPaths: string[] = [];
  for (let index = 0; index < globalThis.localStorage.length; index++) {
    const key = globalThis.localStorage.key(index);
    if (!key?.startsWith(LEGACY_STORAGE_PREFIX)) {
      continue;
    }
    if (globalThis.localStorage.getItem(key) === "1") {
      legacyPaths.push(key.slice(LEGACY_STORAGE_PREFIX.length));
    }
    globalThis.localStorage.removeItem(key);
  }

  if (legacyPaths.length === 0) {
    return null;
  }

  const settings = await getAppSettings();
  const known = new Set(settings.importOfferedPaths ?? []);
  for (const path of legacyPaths) {
    if (!known.has(path)) {
      await markImportOffered(path);
    }
  }

  const updated = await getAppSettings();
  return updated.importOfferedPaths ?? [];
}
