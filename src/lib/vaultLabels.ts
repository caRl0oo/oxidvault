// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "@/lib/i18n";
import type { SecretKind } from "@/types/vault";
import type { DashboardFilterKind } from "@/types/dashboardFilter";

export function getSecretTypeLabel(kind: SecretKind): string {
  return i18n.t(`secretType.${kind}`);
}

export function getSecretTypeDescription(kind: SecretKind): string {
  return i18n.t(`secretType.desc.${kind}`);
}

export function getDbTypeLabel(value: string): string {
  const key = `dbType.${value}`;
  if (i18n.exists(key)) {
    return i18n.t(key);
  }
  return value;
}

export function getWifiEncryptionLabel(value: string): string {
  const key = `wifiEncryption.${value}`;
  if (i18n.exists(key)) {
    return i18n.t(key);
  }
  return value;
}

export function getDashboardFilterLabel(kind: DashboardFilterKind): string {
  return i18n.t(`dashboardFilter.${kind}`);
}

export const DB_TYPE_VALUES = [
  "postgresql",
  "mysql",
  "mariadb",
  "mssql",
  "sqlite",
  "mongodb",
  "redis",
  "oracle",
  "other",
] as const;

export const WIFI_ENCRYPTION_VALUES = [
  "wpa3",
  "wpa2",
  "wpa",
  "wep",
  "open",
  "enterprise",
  "other",
] as const;

export const SECRET_KINDS: SecretKind[] = [
  "web_login",
  "ssh_key",
  "api_token",
  "database",
  "network_wifi",
  "secure_note",
];
