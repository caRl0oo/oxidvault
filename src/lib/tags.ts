// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { SecretEntrySummary } from "@/types/vault";

/** Collect unique tags from all entries (case-insensitive dedupe, original casing preserved). */
export function collectUniqueTags(entries: SecretEntrySummary[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(trimmed);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b, "de"));
}

export function entryHasTag(entry: SecretEntrySummary, tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  if (!needle) return true;
  return (entry.tags ?? []).some((t) => t.trim().toLowerCase() === needle);
}

export function filterEntriesByTag(
  entries: SecretEntrySummary[],
  activeTag: string | null,
): SecretEntrySummary[] {
  if (!activeTag) return entries;
  return entries.filter((e) => entryHasTag(e, activeTag));
}

export interface FolderGroup {
  folder: string;
  entries: SecretEntrySummary[];
}

const UNCategorized = "Ohne Ordner";

/** Groups entries by folder; uncategorized last. */
export function groupEntriesByFolder(entries: SecretEntrySummary[]): FolderGroup[] {
  const map = new Map<string, SecretEntrySummary[]>();

  for (const entry of entries) {
    const key = entry.folder?.trim() || UNCategorized;
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }

  const folders = [...map.keys()].sort((a, b) => {
    if (a === UNCategorized) return 1;
    if (b === UNCategorized) return -1;
    return a.localeCompare(b, "de");
  });

  return folders.map((folder) => ({
    folder,
    entries: map.get(folder) ?? [],
  }));
}

export function shouldGroupByFolder(entries: SecretEntrySummary[]): boolean {
  return entries.some((e) => !!e.folder?.trim());
}
