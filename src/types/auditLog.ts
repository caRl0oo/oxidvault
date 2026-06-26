// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export interface AuditLogEntry {
  timestampUtc: string;
  action: string;
  entryId: string;
  entryHash: string;
}
