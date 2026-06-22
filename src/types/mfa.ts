export interface MfaSetupInfo {
  accountLabel: string;
  otpauthUri: string;
  qrCodePngBase64: string;
}

export interface MfaStatus {
  mfaEnabled: boolean;
  vaultLocked: boolean;
}
