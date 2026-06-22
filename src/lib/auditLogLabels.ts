import i18n from "@/lib/i18n";

const AUDIT_ACTION_KEYS = [
  "VaultCreated",
  "VaultOpened",
  "VaultUnlocked",
  "VaultLocked",
  "EntryCreated",
  "EntryUpdated",
  "EntryDeleted",
  "SecretCopied",
  "SecretRevealed",
  "VaultKeyRotated",
] as const;

export function formatAuditAction(action: string): string {
  const key = `audit.actions.${action}`;
  if (AUDIT_ACTION_KEYS.includes(action as (typeof AUDIT_ACTION_KEYS)[number])) {
    return i18n.t(key);
  }
  return action;
}

export function formatAuditEntryId(entryId: string): string {
  if (entryId === "-" || entryId.trim() === "") {
    return i18n.t("common.dash");
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
