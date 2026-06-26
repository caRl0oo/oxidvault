// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { GitSyncStatusIndicator } from "@/components/GitSyncStatusIndicator";
import { VaultLockButton } from "@/components/ui/VaultLockButton";
import type { GitSyncSettings } from "@/types/settings";
import type { VaultInfo } from "@/types/vault";

interface AppVaultStatusProps {
  readonly vaultInfo: VaultInfo | null;
  readonly gitSyncSettings: GitSyncSettings;
  readonly gitSyncing: boolean;
  readonly gitSyncError: string | null;
  readonly onOpenGitSettings: () => void;
  readonly onLock: () => void;
}

export function AppVaultStatus({
  vaultInfo,
  gitSyncSettings,
  gitSyncing,
  gitSyncError,
  onOpenGitSettings,
  onLock,
}: Readonly<AppVaultStatusProps>) {
  const { t } = useTranslation();

  if (!vaultInfo) {
    return null;
  }

  const showGitSync = vaultInfo.initialized && gitSyncSettings.enabled;

  return (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      {showGitSync ? (
        <GitSyncStatusIndicator
          syncing={gitSyncing}
          syncError={gitSyncError}
          onOpenSettings={onOpenGitSettings}
        />
      ) : null}
      <div
        className={`flex items-center gap-2 ${
          showGitSync ? "border-l border-vault-border/40 pl-2" : ""
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${vaultInfo.locked ? "bg-vault-danger" : "bg-vault-success"}`}
          aria-hidden
        />
        <span className="text-vault-muted">
          {vaultInfo.locked ? t("app.statusLocked") : t("app.statusUnlocked")} · v
          {vaultInfo.version}
        </span>
        <VaultLockButton locked={vaultInfo.locked} onLock={onLock} />
      </div>
    </div>
  );
}
