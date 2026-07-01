// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

interface CsvParseState {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
}

function createCsvParseState(): CsvParseState {
  return { rows: [], row: [], field: "", inQuotes: false };
}

function pushField(state: CsvParseState): void {
  state.row.push(state.field);
  state.field = "";
}

function pushRow(state: CsvParseState): void {
  if (state.row.length === 0 && state.field.length === 0) {
    return;
  }
  pushField(state);
  state.rows.push(state.row);
  state.row = [];
}

function handleQuote(state: CsvParseState, next: string | undefined): number {
  if (state.inQuotes && next === '"') {
    state.field += '"';
    return 1;
  }
  state.inQuotes = !state.inQuotes;
  return 0;
}

function handleNewline(state: CsvParseState, char: string, next: string | undefined): number {
  pushRow(state);
  return char === "\r" && next === "\n" ? 1 : 0;
}

function isDelimiter(char: string): boolean {
  return char === "," || char === "\t";
}

function isNewline(char: string): boolean {
  return char === "\n" || char === "\r";
}

function finalizeCsvParse(state: CsvParseState): string[][] {
  if (state.field.length > 0 || state.row.length > 0) {
    pushField(state);
    state.rows.push(state.row);
  }
  return state.rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

function processCsvChar(state: CsvParseState, char: string, next: string | undefined): number {
  if (char === '"') {
    return handleQuote(state, next);
  }
  if (!state.inQuotes && isDelimiter(char)) {
    pushField(state);
    return 0;
  }
  if (!state.inQuotes && isNewline(char)) {
    return handleNewline(state, char, next);
  }
  state.field += char;
  return 0;
}

/** Minimal RFC 4180-style CSV parser (quoted fields, commas). */
export function parseCsv(content: string): string[][] {
  const state = createCsvParseState();

  for (let i = 0; i < content.length; i++) {
    i += processCsvChar(state, content[i], content[i + 1]);
  }

  return finalizeCsvParse(state);
}

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, "");
}

export function buildHeaderIndex(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, position) => {
    index.set(normalizeHeader(header), position);
  });
  return index;
}

export function cellAt(row: string[], index: Map<string, number>, ...keys: string[]): string {
  for (const key of keys) {
    const position = index.get(normalizeHeader(key));
    if (position !== undefined) {
      return row[position]?.trim() ?? "";
    }
  }
  return "";
}
