// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { buildHeaderIndex, cellAt, normalizeHeader, parseCsv } from "@/import/csv";
import type { ParsedImportEntry, ParseResult } from "@/import/types";
import { finalizeParseResult } from "@/import/shared";

export function looksLikeChromeCsv(content: string): boolean {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return false;
  }
  const headers = new Set(rows[0].map(normalizeHeader));
  return headers.has("name") && headers.has("url") && headers.has("password");
}

export function parseChrome(content: string): ParseResult {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return { entries: [], skippedInvalid: 0 };
  }

  const index = buildHeaderIndex(rows[0]);
  const entries: ParsedImportEntry[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    entries.push({
      title: cellAt(row, index, "name", "Name"),
      url: cellAt(row, index, "url", "URL"),
      username: cellAt(row, index, "username", "Username"),
      password: cellAt(row, index, "password", "Password"),
      tags: [],
    });
  }

  return finalizeParseResult(entries);
}
