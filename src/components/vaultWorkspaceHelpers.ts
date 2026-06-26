// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export function formatEntryCountLabel(
  hasSidebarFilter: boolean,
  filteredCount: number,
  totalCount: number,
): string {
  if (hasSidebarFilter) {
    return `${filteredCount}/${totalCount}`;
  }
  return String(totalCount);
}

export type VaultWidthLayoutKey = number | "init";

export function buildTerminalLayoutKey(
  sshFocusMode: boolean,
  vaultWidthPx: VaultWidthLayoutKey = "init",
): string {
  const mode = sshFocusMode ? "focus" : "split";
  return `${mode}-${vaultWidthPx}`;
}

export function isSshSplitActive(
  sshTerminal: unknown,
  sshFocusMode: boolean,
): boolean {
  return sshTerminal !== null && !sshFocusMode;
}
