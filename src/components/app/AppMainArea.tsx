// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsView } from "@/components/settings/SettingsView";
import type { SettingsCategory } from "@/components/settings/types";
import type { GitSyncSettings } from "@/types/settings";

interface AppMainAreaProps {
  readonly settingsOpen: boolean;
  readonly settingsCategory: SettingsCategory;
  readonly onCloseSettings: () => void;
  readonly onGitSyncChange: (settings: GitSyncSettings) => void;
  readonly onTriggerGitSync: () => void;
  readonly gitSyncing: boolean;
  readonly vaultLocked: boolean;
  readonly isMultiUser?: boolean;
  readonly onGoToUnlock: () => void;
  readonly idleWarningSeconds: number | null;
  readonly vaultUnlocked: boolean;
  readonly onOpenImport?: () => void;
  readonly children: ReactNode;
}

export function AppMainArea({
  settingsOpen,
  settingsCategory,
  onCloseSettings,
  onGitSyncChange,
  onTriggerGitSync,
  gitSyncing,
  vaultLocked,
  isMultiUser = false,
  onGoToUnlock,
  idleWarningSeconds,
  vaultUnlocked,
  onOpenImport,
  children,
}: Readonly<AppMainAreaProps>) {
  const { t } = useTranslation();

  if (settingsOpen) {
    return (
      <SettingsView
        initialCategory={settingsCategory}
        vaultLocked={vaultLocked}
        isMultiUser={isMultiUser}
        onBack={onCloseSettings}
        onGoToUnlock={onGoToUnlock}
        onGitSyncChange={onGitSyncChange}
        onTriggerGitSync={onTriggerGitSync}
        gitSyncing={gitSyncing}
        onOpenImport={onOpenImport}
      />
    );
  }

  return (
    <>
      {idleWarningSeconds !== null && vaultUnlocked ? (
        <output className="block shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          {t("app.idleLockWarning", { seconds: idleWarningSeconds })}
        </output>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  );
}
