// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { buildHeaderIndex, cellAt, parseCsv } from "@/import/csv";
import type { ParsedImportEntry, ParseResult } from "@/import/types";
import { finalizeParseResult, splitTags } from "@/import/shared";

const REQUIRED_HEADERS = ["title", "username", "password"];

export function looksLikeOnePasswordCsv(content: string): boolean {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return false;
  }
  const index = buildHeaderIndex(rows[0]);
  return REQUIRED_HEADERS.every((header) => index.has(header));
}

export function parseOnePassword(content: string): ParseResult {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return { entries: [], skippedInvalid: 0 };
  }

  const index = buildHeaderIndex(rows[0]);
  const entries: ParsedImportEntry[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const tags = splitTags(cellAt(row, index, "Tags", "Tag"));
    entries.push({
      title: cellAt(row, index, "Title"),
      url: cellAt(row, index, "Website", "URL", "Url"),
      username: cellAt(row, index, "Username"),
      password: cellAt(row, index, "Password"),
      notes: cellAt(row, index, "Notes", "Note") || undefined,
      tags,
    });
  }

  return finalizeParseResult(entries);
}
