// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ParsedImportEntry, ParseResult } from "@/import/types";

function isValidSecureNoteImport(entry: ParsedImportEntry): boolean {
  return entry.title.trim().length > 0 && (entry.content?.trim().length ?? 0) > 0;
}

function isValidWebLoginImport(entry: ParsedImportEntry): boolean {
  if (!entry.title.trim() && !entry.password) {
    return false;
  }
  return (
    entry.url.trim().length > 0 &&
    entry.username.trim().length > 0 &&
    entry.password.length > 0
  );
}

export function isValidImportEntry(entry: ParsedImportEntry): boolean {
  if (entry.kind === "secure_note") {
    return isValidSecureNoteImport(entry);
  }
  return isValidWebLoginImport(entry);
}

export function finalizeParseResult(entries: ParsedImportEntry[]): ParseResult {
  const valid: ParsedImportEntry[] = [];
  let skippedInvalid = 0;

  for (const entry of entries) {
    if (isValidImportEntry(entry)) {
      valid.push(entry);
    } else {
      skippedInvalid++;
    }
  }

  return { entries: valid, skippedInvalid };
}

export function splitTags(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function tagFromGroup(group: string): string[] {
  const trimmed = group.trim();
  return trimmed ? [trimmed] : [];
}
