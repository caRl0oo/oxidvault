// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { looksLikeBitwardenExport, parseBitwarden } from "@/import/bitwarden";
import { looksLikeChromeCsv, parseChrome } from "@/import/chrome";
import { looksLikeKeePassCsv, parseKeePass } from "@/import/keepass";
import { looksLikeOnePasswordCsv, parseOnePassword } from "@/import/onepassword";
import { looksLikeRoboformCsv, parseRoboform } from "@/import/roboform";
import type {
  ImportExecutionResult,
  ImportFormat,
  ImportPreview,
  ParseResult,
  ParsedImportEntry,
} from "@/import/types";
import type { SecretEntryInputFull, SecretEntrySummary } from "@/types/vault";

export function validateImportFormat(content: string, format: ImportFormat): boolean {
  switch (format) {
    case "bitwarden":
      return looksLikeBitwardenExport(content);
    case "onepassword":
      return looksLikeOnePasswordCsv(content);
    case "keepass":
      return looksLikeKeePassCsv(content);
    case "chrome":
      return looksLikeChromeCsv(content);
    case "roboform":
      return looksLikeRoboformCsv(content);
  }
}

export function parseImportFile(content: string, format: ImportFormat): ParseResult {
  switch (format) {
    case "bitwarden":
      return parseBitwarden(content);
    case "onepassword":
      return parseOnePassword(content);
    case "keepass":
      return parseKeePass(content);
    case "chrome":
      return parseChrome(content);
    case "roboform":
      return parseRoboform(content);
  }
}

function duplicateKey(entry: ParsedImportEntry): string {
  if (entry.kind === "secure_note") {
    return `secure_note\u0000${entry.title.trim().toLowerCase()}`;
  }
  return `web_login\u0000${entry.title.trim().toLowerCase()}\u0000${entry.url.trim().toLowerCase()}`;
}

function existingKeys(entries: SecretEntrySummary[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.entry_type === "secure_note") {
      keys.add(`secure_note\u0000${entry.title.trim().toLowerCase()}`);
      continue;
    }
    if (entry.entry_type !== "web_login") {
      continue;
    }
    keys.add(
      `web_login\u0000${entry.title.trim().toLowerCase()}\u0000${(entry.subtitle ?? "").trim().toLowerCase()}`,
    );
  }
  return keys;
}

export function buildImportPreview(
  parsed: ParseResult,
  vaultEntries: SecretEntrySummary[],
): ImportPreview {
  const seen = existingKeys(vaultEntries);
  const toImport: ParsedImportEntry[] = [];
  let duplicateCount = 0;

  for (const entry of parsed.entries) {
    const key = duplicateKey(entry);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    toImport.push(entry);
  }

  return {
    entries: toImport,
    duplicateCount,
    importableCount: toImport.length,
  };
}

export function toSecretInput(entry: ParsedImportEntry): SecretEntryInputFull {
  if (entry.kind === "secure_note") {
    return {
      title: entry.title.trim() || "Imported note",
      tags: entry.tags,
      type: "secure_note",
      content: entry.content?.trim() ?? "",
    };
  }

  const title = entry.title.trim() || entry.url || entry.username || "Imported entry";
  const input: SecretEntryInputFull = {
    title,
    tags: entry.tags,
    type: "web_login",
    url: entry.url,
    username: entry.username,
    password: entry.password,
  };

  if (entry.notes?.trim()) {
    input.notes = entry.notes.trim();
  }

  return input;
}

export async function executeImport(
  preview: ImportPreview,
  addEntry: (input: SecretEntryInputFull) => Promise<unknown>,
  skippedInvalid: number,
): Promise<ImportExecutionResult> {
  let imported = 0;
  let failed = 0;

  for (const entry of preview.entries) {
    try {
      await addEntry(toSecretInput(entry));
      imported++;
    } catch {
      failed++;
    }
  }

  return {
    imported,
    skippedDuplicates: preview.duplicateCount,
    skippedInvalid,
    failed,
  };
}

export const IMPORT_FORMATS: ImportFormat[] = [
  "bitwarden",
  "onepassword",
  "keepass",
  "chrome",
  "roboform",
];
