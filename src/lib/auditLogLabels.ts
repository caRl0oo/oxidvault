const AUDIT_ACTION_LABELS: Record<string, string> = {
  VaultCreated: "Tresor wurde erstellt",
  VaultOpened: "Tresor wurde geöffnet",
  VaultUnlocked: "Tresor wurde entsperrt",
  VaultLocked: "Tresor wurde gesperrt",
  EntryCreated: "Eintrag wurde erstellt",
  EntryUpdated: "Eintrag wurde aktualisiert",
  SecretCopied: "Secret wurde in die Zwischenablage kopiert",
  SecretRevealed: "Secret wurde angezeigt",
};

export function formatAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function formatAuditEntryId(entryId: string): string {
  if (entryId === "-" || entryId.trim() === "") {
    return "—";
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
