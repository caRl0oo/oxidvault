// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ParsedImportEntry, ParseResult } from "@/import/types";
import { finalizeParseResult } from "@/import/shared";

interface BitwardenUri {
  uri?: string;
}

interface BitwardenLogin {
  username?: string;
  password?: string;
  uris?: BitwardenUri[];
}

interface BitwardenItem {
  type?: number;
  name?: string;
  notes?: string;
  login?: BitwardenLogin;
}

interface BitwardenExport {
  items?: BitwardenItem[];
}

function firstUri(login?: BitwardenLogin): string {
  const uris = login?.uris;
  if (!uris?.length) {
    return "";
  }
  return uris[0]?.uri?.trim() ?? "";
}

export function looksLikeBitwardenExport(content: string): boolean {
  try {
    const data = JSON.parse(content) as BitwardenExport | BitwardenItem[];
    const items = Array.isArray(data) ? data : data.items;
    return (
      Array.isArray(items) &&
      items.some((item) => item.login !== undefined || item.type === 1)
    );
  } catch {
    return false;
  }
}

export function parseBitwarden(content: string): ParseResult {
  const data = JSON.parse(content) as BitwardenExport | BitwardenItem[];
  const items = Array.isArray(data) ? data : (data.items ?? []);

  const entries: ParsedImportEntry[] = [];

  for (const item of items) {
    if (item.type !== undefined && item.type !== 1) {
      continue;
    }
    if (!item.login) {
      continue;
    }

    entries.push({
      title: item.name?.trim() ?? "",
      url: firstUri(item.login),
      username: item.login.username?.trim() ?? "",
      password: item.login.password ?? "",
      notes: item.notes?.trim() || undefined,
      tags: [],
    });
  }

  return finalizeParseResult(entries);
}
