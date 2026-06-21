export type SecretKind =
  | "web_login"
  | "ssh_key"
  | "api_token"
  | "database"
  | "network_wifi"
  | "secure_note";

export type SecretField =
  | "primary"
  | "password"
  | "token"
  | "private_key"
  | "passphrase"
  | "content"
  | "notes";

export interface RevealedSecret {
  value: string;
  warning: string;
}

export interface WebLoginPublic {
  type: "web_login";
  url: string;
  username: string;
  has_notes: boolean;
  has_password: boolean;
}

export interface SshKeyPublic {
  type: "ssh_key";
  host: string;
  username: string;
  has_private_key: boolean;
  has_passphrase: boolean;
}

export interface ApiTokenPublic {
  type: "api_token";
  service: string;
  has_token: boolean;
}

export interface DatabasePublic {
  type: "database";
  host: string;
  port: number;
  db_type: string;
  database_name: string;
  username: string;
  has_password: boolean;
}

export interface NetworkWifiPublic {
  type: "network_wifi";
  ssid: string;
  encryption_type: string;
  has_password: boolean;
}

export interface SecureNotePublic {
  type: "secure_note";
  preview?: string;
  has_content: boolean;
}

export type SecretPayloadPublic =
  | WebLoginPublic
  | SshKeyPublic
  | ApiTokenPublic
  | DatabasePublic
  | NetworkWifiPublic
  | SecureNotePublic;

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

export type SecretEntryPublic = SecretEntry & SecretPayloadPublic;

export interface SecretEntryInput {
  title: string;
  folder?: string;
  tags?: string[];
  expires_at?: string;
}

export type SecretEntryInputFull = SecretEntryInput & SecretPayload;

export const DEFAULT_PASSWORD_LENGTH = 24;

export interface PasswordGenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export function isProbeableEntryType(type: SecretKind): boolean {
  return type === "web_login" || type === "ssh_key" || type === "database";
}
