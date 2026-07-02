// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "@/lib/i18n";

const AUDIT_ACTION_KEYS = [
  "VaultCreated",
  "VaultOpened",
  "VaultUnlocked",
  "VaultLocked",
  "EntryCreated",
  "EntryUpdated",
  "EntryDeleted",
  "SecretCreated",
  "SecretModified",
  "SecretCopied",
  "SecretRevealed",
  "SecretAutofilled",
  "BridgeThrottled",
  "VaultKeyRotated",
  "AuthFailed",
  "SyncEvent",
  "ConfigChanged",
  "SshHostTrusted",
  "UserAdded",
  "UserRemoved",
  "UserPasswordChanged",
  "UserRoleChanged",
  "UserMfaEnabled",
  "UserMfaDisabled",
  "VaultMigratedToV3",
  "Checkpoint",
] as const;

const LEGACY_ACTION_ALIASES: Record<string, (typeof AUDIT_ACTION_KEYS)[number]> = {
  EntryCreated: "SecretCreated",
  EntryUpdated: "SecretModified",
};

export function formatAuditAction(action: string): string {
  const normalized = LEGACY_ACTION_ALIASES[action] ?? action;
  const key = `audit.actions.${normalized}`;
  if ((AUDIT_ACTION_KEYS as readonly string[]).includes(normalized)) {
    return i18n.t(key);
  }
  return action;
}

export function formatAuditEntryId(action: string, entryId: string): string {
  if (entryId === "-" || entryId.trim() === "") {
    return i18n.t("common.dash");
  }

  if (action === "SyncEvent") {
    const statusKey = `audit.syncStatus.${entryId}`;
    if (i18n.exists(statusKey)) {
      return i18n.t(statusKey);
    }
    return entryId;
  }

  if (action === "ConfigChanged") {
    const areaKey = `audit.configAreas.${entryId}`;
    if (i18n.exists(areaKey)) {
      return i18n.t(areaKey);
    }
    return entryId;
  }

  return entryId;
}

export function formatAuditTimestampUtc(timestampUtc: string): string {
  const date = new Date(timestampUtc);
  if (Number.isNaN(date.getTime())) {
    return timestampUtc;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
