// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { buildHeaderIndex, cellAt, parseCsv } from "@/import/csv";
import type { ParsedImportEntry, ParseResult } from "@/import/types";
import { finalizeParseResult, tagFromGroup } from "@/import/shared";

/** RoboForm may append opaque or JSON payloads in RfFieldsV2 — only keep human-readable text. */
export function isReadableRfFieldsText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }

  const nonReadable = trimmed.replace(/[\s\p{L}\p{N}\p{P}]/gu, "");
  if (nonReadable.length / trimmed.length > 0.15) {
    return false;
  }

  if (
    trimmed.length > 80 &&
    !/\s/.test(trimmed) &&
    /^[A-Za-z0-9+/=_-]+$/.test(trimmed)
  ) {
    return false;
  }

  return true;
}

export function resolveRoboformNotes(
  row: string[],
  index: Map<string, number>,
): string | undefined {
  const note = cellAt(row, index, "Note").trim();
  if (note) {
    return note;
  }

  const rfFields = cellAt(row, index, "RfFieldsV2", "RfFields").trim();
  if (rfFields && isReadableRfFieldsText(rfFields)) {
    return rfFields;
  }

  return undefined;
}

function isRoboformSecureNote(row: string[], index: Map<string, number>): boolean {
  const password = cellAt(row, index, "Pwd", "Password");
  const username = cellAt(row, index, "Login");
  const note = cellAt(row, index, "Note").trim();
  return password.length === 0 && username.length === 0 && note.length > 0;
}

export function looksLikeRoboformCsv(content: string): boolean {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return false;
  }
  const index = buildHeaderIndex(rows[0]);
  return index.has("name") && index.has("login") && index.has("pwd");
}

export function parseRoboform(content: string): ParseResult {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return { entries: [], skippedInvalid: 0 };
  }

  const index = buildHeaderIndex(rows[0]);
  const entries: ParsedImportEntry[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const folder = cellAt(row, index, "Folder");
    const title = cellAt(row, index, "Name");
    const tags = tagFromGroup(folder);

    if (isRoboformSecureNote(row, index)) {
      entries.push({
        kind: "secure_note",
        title,
        content: cellAt(row, index, "Note").trim(),
        url: "",
        username: "",
        password: "",
        tags,
      });
      continue;
    }

    entries.push({
      kind: "web_login",
      title,
      url: cellAt(row, index, "Url", "URL"),
      username: cellAt(row, index, "Login"),
      password: cellAt(row, index, "Pwd", "Password"),
      notes: resolveRoboformNotes(row, index),
      tags,
    });
  }

  return finalizeParseResult(entries);
}
