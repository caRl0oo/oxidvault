export interface GitSyncSettings {
  enabled: boolean;
  remoteUrl?: string | null;
}

export interface AppSettings {
  lastVaultPath?: string | null;
  gitSync: GitSyncSettings;
}

export interface GitSyncResult {
  pulled: boolean;
  pushed: boolean;
  message: string;
  vaultReloaded: boolean;
}
