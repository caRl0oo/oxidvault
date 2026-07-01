// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export type ImportFormat =
  | "bitwarden"
  | "onepassword"
  | "keepass"
  | "chrome"
  | "roboform";

export type ParsedImportKind = "web_login" | "secure_note";

export interface ParsedImportEntry {
  kind?: ParsedImportKind;
  title: string;
  url: string;
  username: string;
  password: string;
  notes?: string;
  /** Secure note body (`secure_note.content`). */
  content?: string;
  tags: string[];
}

export interface ParseResult {
  entries: ParsedImportEntry[];
  skippedInvalid: number;
}

export interface ImportPreview {
  entries: ParsedImportEntry[];
  duplicateCount: number;
  importableCount: number;
}

export interface ImportExecutionResult {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  failed: number;
}
