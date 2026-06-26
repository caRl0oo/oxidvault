// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export type SettingsCategory = "general" | "sync" | "security" | "users";

export function requiresUnlockedVault(category: SettingsCategory): boolean {
  return category === "sync" || category === "security" || category === "users";
}
