// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

export interface GitSyncSettings {
  enabled: boolean;
  remoteUrl?: string | null;
  sshKeyPath?: string | null;
  httpsUsername?: string | null;
}

export interface AppSettings {
  lastVaultPath?: string | null;
  gitSync: GitSyncSettings;
  autoLockSeconds?: number;
}

export interface GitSyncResult {
  pulled: boolean;
  pushed: boolean;
  message: string;
  vaultReloaded: boolean;
}
