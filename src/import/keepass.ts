// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { buildHeaderIndex, cellAt, parseCsv } from "@/import/csv";
import type { ParsedImportEntry, ParseResult } from "@/import/types";
import { finalizeParseResult, tagFromGroup } from "@/import/shared";

export function looksLikeKeePassCsv(content: string): boolean {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return false;
  }
  const index = buildHeaderIndex(rows[0]);
  return (
    index.has("account") ||
    (index.has("loginname") && index.has("password"))
  );
}

export function parseKeePass(content: string): ParseResult {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return { entries: [], skippedInvalid: 0 };
  }

  const index = buildHeaderIndex(rows[0]);
  const entries: ParsedImportEntry[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const group = cellAt(row, index, "Group", "Group Path");
    entries.push({
      title: cellAt(row, index, "Account", "Title"),
      url: cellAt(row, index, "Web Site", "URL", "Url"),
      username: cellAt(row, index, "Login Name", "User Name", "Username"),
      password: cellAt(row, index, "Password"),
      notes: cellAt(row, index, "Comments", "Notes") || undefined,
      tags: tagFromGroup(group),
    });
  }

  return finalizeParseResult(entries);
}
