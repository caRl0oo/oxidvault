export const KEY_ROTATION_THRESHOLD_DAYS = 90;

export interface ComplianceStatus {
  policyManagedByGpo: boolean;
  auditChainValid: boolean;
  keyCreatedAt: string | null;
  keyRotatedAt: string | null;
  keyAgeDays: number;
  keyRotationRecommended: boolean;
}
