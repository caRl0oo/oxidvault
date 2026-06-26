// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export const EXPIRY_WARN_DAYS = 14;

export type ExpiryStatus =
  | { kind: "expired" }
  | { kind: "expiring_soon"; daysRemaining: number };

interface DateParts {
  y: number;
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a calendar date string `YYYY-MM-DD` without timezone conversion. */
export function parseDateOnly(value: string): DateParts | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Local calendar date for the current moment. */
export function todayLocal(): DateParts {
  const now = new Date();
  return {
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  };
}

/** Whole calendar days from `from` to `to` (exclusive of time-of-day). */
export function daysBetween(from: DateParts, to: DateParts): number {
  const start = Date.UTC(from.y, from.m - 1, from.d);
  const end = Date.UTC(to.y, to.m - 1, to.d);
  return Math.round((end - start) / 86_400_000);
}

export function getExpiryStatus(expiresAt?: string | null): ExpiryStatus | null {
  if (!expiresAt) return null;
  const expiry = parseDateOnly(expiresAt);
  if (!expiry) return null;
  const days = daysBetween(todayLocal(), expiry);
  if (days < 0) return { kind: "expired" };
  if (days <= EXPIRY_WARN_DAYS) return { kind: "expiring_soon", daysRemaining: days };
  return null;
}

export function formatExpiryDate(iso: string): string {
  const parts = parseDateOnly(iso);
  if (!parts) return iso;
  const dd = String(parts.d).padStart(2, "0");
  const mm = String(parts.m).padStart(2, "0");
  return `${dd}.${mm}.${parts.y}`;
}
