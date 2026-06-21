const ERROR_MAP: Record<string, string> = {
  "title is required": "Titel ist erforderlich.",
  "fields are incomplete": "Bitte alle Pflichtfelder ausfüllen.",
  "invalid master password": "Master-Passwort ist falsch.",
  "vault is locked by": "Vault wird bereits von einer anderen Instanz verwendet.",
  "weak master password": "Master-Passwort erfüllt nicht die Sicherheitsrichtlinie.",
  "too common": "Dieses Passwort ist zu häufig — bitte ein einzigartiges wählen.",
  "at least 12 characters": "Mindestens 12 Zeichen erforderlich.",
  "vault file already exists": "An diesem Speicherort existiert bereits eine Vault-Datei.",
  "invalid vault file": "Ungültige oder beschädigte .oxid-Datei.",
  "vault not initialized": "Vault ist nicht initialisiert.",
  "no vault file loaded": "Keine Vault-Datei geladen.",
  "audit log corrupted": "Audit-Log ist beschädigt — Export abgebrochen (Hash-Kette unterbrochen).",
  "url ist leer": "URL ist leer.",
  "url ist ungültig": "URL ist ungültig.",
  "url muss mit http:// oder https:// beginnen": "URL muss mit http:// oder https:// beginnen.",
  "url enthält ungültige zeichen": "URL enthält ungültige Zeichen.",
  "url darf keine leerzeichen enthalten": "URL darf keine Leerzeichen enthalten.",
  "database fields are incomplete": "Bitte alle Datenbank-Felder ausfüllen.",
  "network wifi fields are incomplete": "Bitte alle WLAN-Felder ausfüllen.",
  "secure note content is required": "Notiz-Inhalt ist erforderlich.",
};

export function formatVaultError(error: unknown): string {
  const raw = String(error).replace(/^Error:\s*/i, "").trim();
  const lower = raw.toLowerCase();
  for (const [key, message] of Object.entries(ERROR_MAP)) {
    if (lower.includes(key)) return message;
  }
  return raw || "Unbekannter Fehler";
}
