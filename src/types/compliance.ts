// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export const KEY_ROTATION_THRESHOLD_DAYS = 90;

export interface ComplianceStatus {
  policyManagedByGpo: boolean;
  auditChainValid: boolean;
  auditChainAuthenticated: boolean | null;
  auditAuthenticationStatus: string | null;
  keyCreatedAt: string | null;
  keyRotatedAt: string | null;
  keyAgeDays: number;
  keyRotationRecommended: boolean;
  vaultFormatVersion: number;
  legacyFormatMigrationRecommended: boolean;
}

/** On-disk vault header format versions below v3 lack authenticated multi-user headers. */
export const LEGACY_VAULT_FORMAT_MAX_VERSION = 2;
