// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

export interface MfaSetupInfo {
  accountLabel: string;
  otpauthUri: string;
  qrCodePngBase64: string;
}

export interface MfaStatus {
  mfaEnabled: boolean;
  vaultLocked: boolean;
}
