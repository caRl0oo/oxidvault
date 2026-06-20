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



export const WEAK_REASON_LABELS: Record<string, string> = {

  short: "Kürzer als 12 Zeichen",

  no_digit: "Keine Ziffer",

  no_symbol: "Kein Sonderzeichen",

};



export const EXPIRY_STATUS_LABELS: Record<ExpiringPasswordEntry["status"], string> = {

  expired: "Abgelaufen",

  expiring_soon: "Läuft bald ab",

};


