export interface AuditLogEntry {
  timestampUtc: string;
  action: string;
  entryId: string;
  entryHash: string;
}
