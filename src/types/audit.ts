// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export interface DuplicatePasswordGroup {
  entryIds: string[];
  titles: string[];
  count: number;
}

export interface WeakPasswordEntry {
  entryId: string;
  title: string;
  reasons: string[];
}

export interface ExpiringPasswordEntry {
  entryId: string;
  title: string;
  expiresAt: string;
  status: "expired" | "expiring_soon";
  daysUntilExpiry: number;
}

export interface SecurityAuditReport {
  scorePercent: number;
  totalAudited: number;
  weakCount: number;
  duplicateGroupCount: number;
  duplicateEntryCount: number;
  expiringCount: number;
  duplicateGroups: DuplicatePasswordGroup[];
  weakEntries: WeakPasswordEntry[];
  expiringEntries: ExpiringPasswordEntry[];
}
