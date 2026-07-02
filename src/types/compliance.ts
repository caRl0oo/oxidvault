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
}
