export type SecretKind =
  | "web_login"
  | "ssh_key"
  | "api_token"
  | "database"
  | "network_wifi"
  | "secure_note";

export interface WebLoginPayload {
  type: "web_login";
  url: string;
  username: string;
  password: string;
  notes?: string;
}

export interface SshKeyPayload {
  type: "ssh_key";
  host: string;
  username: string;
  private_key: string;
  passphrase?: string;
}

export interface ApiTokenPayload {
  type: "api_token";
  service: string;
  token: string;
}

export interface DatabasePayload {
  type: "database";
  host: string;
  port: number;
  db_type: string;
  database_name: string;
  username: string;
  password: string;
}

export interface NetworkWifiPayload {
  type: "network_wifi";
  ssid: string;
  encryption_type: string;
  password: string;
}

export interface SecureNotePayload {
  type: "secure_note";
  content: string;
}

export type SecretPayload =
  | WebLoginPayload
  | SshKeyPayload
  | ApiTokenPayload
  | DatabasePayload
  | NetworkWifiPayload
  | SecureNotePayload;

export interface VaultInfo {
  version: string;
  name: string;
  path: string | null;
  entry_count: number;
  locked: boolean;
  initialized: boolean;
}

export interface SecretEntrySummary {
  id: string;
  title: string;
  entry_type: SecretKind;
  folder?: string;
  tags?: string[];
  subtitle?: string;
  username?: string;
  updated_at: string;
}

export interface SecretEntry {
  id: string;
  title: string;
  folder?: string;
  tags?: string[];
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export type SecretEntryFull = SecretEntry & SecretPayload;

export interface SecretEntryInput {
  title: string;
  folder?: string;
  tags?: string[];
  expires_at?: string;
}

export type SecretEntryInputFull = SecretEntryInput & SecretPayload;

export const SECRET_TYPE_LABELS: Record<SecretKind, string> = {
  web_login: "Web-Login",
  ssh_key: "SSH-Key",
  api_token: "API-Token",
  database: "Datenbank",
  network_wifi: "Netzwerk / WLAN",
  secure_note: "Sichere Notiz",
};

export const DB_TYPE_OPTIONS = [
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "mssql", label: "Microsoft SQL Server" },
  { value: "sqlite", label: "SQLite" },
  { value: "mongodb", label: "MongoDB" },
  { value: "redis", label: "Redis" },
  { value: "oracle", label: "Oracle" },
  { value: "other", label: "Sonstige" },
] as const;

export const WIFI_ENCRYPTION_OPTIONS = [
  { value: "wpa3", label: "WPA3" },
  { value: "wpa2", label: "WPA2" },
  { value: "wpa", label: "WPA" },
  { value: "wep", label: "WEP" },
  { value: "open", label: "Offen (keine)" },
  { value: "enterprise", label: "Enterprise (802.1X)" },
  { value: "other", label: "Sonstige" },
] as const;

export const DEFAULT_PASSWORD_LENGTH = 24;

export interface PasswordGenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export function dbTypeLabel(value: string): string {
  return DB_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function wifiEncryptionLabel(value: string): string {
  return WIFI_ENCRYPTION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function isProbeableEntryType(type: SecretKind): boolean {
  return type === "web_login" || type === "ssh_key" || type === "database";
}
