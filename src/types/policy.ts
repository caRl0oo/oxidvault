export interface ResolvedBoolField {
  value: boolean;
  disabled: boolean;
}

export interface ResolvedU32Field {
  value: number;
  disabled: boolean;
}

export interface ResolvedConfig {
  adminPolicyActive: boolean;
  forceLockOnMinimize: ResolvedBoolField;
  autoLockSeconds: ResolvedU32Field;
  gitSyncEnabled: ResolvedBoolField;
  minMasterPasswordLen: ResolvedU32Field;
}
