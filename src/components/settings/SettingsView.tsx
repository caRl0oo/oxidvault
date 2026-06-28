// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutModal } from "@/components/AboutModal";
import { AppLogo } from "@/components/AppLogo";
import { MfaSetupModal } from "@/components/MfaSetupModal";
import { VaultButton } from "@/components/ui/VaultButton";
import { ThemeSwatch } from "@/components/ui/ThemeSwatch";
import { useTheme } from "@/hooks/useTheme";
import { changeAppLocale } from "@/lib/i18n";
import {
  disableMFA,
  getAppSettings,
  getCurrentUser,
  getMfaStatus,
  getResolvedConfig,
  saveSshPassphrase,
  updateAutoLockSeconds,
  updateGitSyncSettings,
} from "@/lib/ipc";
import { LOCALE_OPTIONS, isLocaleId } from "@/lib/locale";
import { runAsync } from "@/lib/runAsync";
import { THEME_IDS, isThemeId, type ThemeId } from "@/lib/theme";
import { STATUS_SUCCESS_CLASS, UI } from "@/lib/uiClasses";
import { APP_NAME, APP_VERSION_LABEL } from "@/lib/appMeta";
import type { GitSyncSettings } from "@/types/settings";
import type { ResolvedConfig } from "@/types/policy";
import type { SettingsCategory } from "@/components/settings/types";
import { requiresUnlockedVault } from "@/components/settings/types";
import { SettingsLockedView } from "@/components/settings/SettingsLockedView";
import { ChangeUserPasswordPanel } from "@/components/settings/ChangeUserPasswordPanel";
import { UserManagementPanel } from "@/components/settings/UserManagementPanel";

const SETTINGS_NAV: SettingsCategory[] = ["general", "sync", "security", "users"];

const AUTO_LOCK_PRESETS = [60, 300, 600, 900, 1800, 0] as const;

const inputClass = `${UI.input} mt-1.5 max-w-xl text-sm`;

const settingsDividerClass = "border-t border-vault-border";

interface SettingsViewProps {
  readonly initialCategory?: SettingsCategory;
  readonly vaultLocked: boolean;
  readonly isMultiUser?: boolean;
  readonly onBack: () => void;
  readonly onGoToUnlock: () => void;
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
  readonly onTriggerGitSync?: () => void;
  readonly gitSyncing?: boolean;
}

export function SettingsView({
  initialCategory = "general",
  vaultLocked,
  isMultiUser = false,
  onBack,
  onGoToUnlock,
  onGitSyncChange,
  onTriggerGitSync,
  gitSyncing = false,
}: Readonly<SettingsViewProps>) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaVaultLocked, setMfaVaultLocked] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaDisableConfirm, setMfaDisableConfirm] = useState(false);
  const [mfaDisabling, setMfaDisabling] = useState(false);

  const [gitEnabled, setGitEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");
  const [gitSaving, setGitSaving] = useState(false);
  const [gitSaved, setGitSaved] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [sshPassphraseSaving, setSshPassphraseSaving] = useState(false);
  const [sshPassphraseSaved, setSshPassphraseSaved] = useState(false);
  const [sshPassphraseError, setSshPassphraseError] = useState<string | null>(null);
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedConfig | null>(null);
  const [autoLockSeconds, setAutoLockSeconds] = useState(600);
  const [autoLockDisabled, setAutoLockDisabled] = useState(false);
  const [autoLockSaving, setAutoLockSaving] = useState(false);
  const [autoLockError, setAutoLockError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCurrentUserAdmin, setIsCurrentUserAdmin] = useState(false);

  const currentLocale = isLocaleId(i18n.language) ? i18n.language : i18n.language.split("-")[0];
  const mfaControlsDisabled = mfaVaultLocked || mfaLoading || mfaDisabling;

  useEffect(() => {
    if (vaultLocked) {
      setCategory("general");
      return;
    }
    setCategory(initialCategory);
  }, [initialCategory, vaultLocked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onBack();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);

  const refreshMfaStatus = useCallback(async () => {
    setMfaLoading(true);
    setMfaError(null);
    try {
      const status = await getMfaStatus();
      setMfaEnabled(status.mfaEnabled);
      setMfaVaultLocked(status.vaultLocked);
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : String(e));
    } finally {
      setMfaLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsync(async () => {
      setLoading(true);
      setMfaError(null);
      try {
        const [settings, resolved, status, currentUser] = await Promise.all([
          getAppSettings(),
          getResolvedConfig(),
          getMfaStatus(),
          isMultiUser && !vaultLocked ? getCurrentUser() : Promise.resolve(null),
        ]);
        setResolvedConfig(resolved);
        setAutoLockSeconds(resolved.autoLockSeconds.value);
        setAutoLockDisabled(resolved.autoLockSeconds.disabled);
        setGitEnabled(resolved.gitSyncEnabled.value);
        setRemoteUrl(settings.gitSync.remoteUrl ?? "");
        setSshKeyPath(settings.gitSync.sshKeyPath ?? "");
        setSshPassphrase("");
        setMfaEnabled(status.mfaEnabled);
        setMfaVaultLocked(status.vaultLocked);
        setIsCurrentUserAdmin(currentUser?.role === "admin");
        onGitSyncChange?.({
          enabled: resolved.gitSyncEnabled.value,
          remoteUrl: settings.gitSync.remoteUrl,
        });
      } catch (e) {
        setMfaError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setMfaLoading(false);
      }
    });
  }, [onGitSyncChange, isMultiUser, vaultLocked]);

  const visibleNav = SETTINGS_NAV.filter((id) => {
    if (vaultLocked) {
      return id === "general";
    }
    return id !== "users" || (isMultiUser && isCurrentUserAdmin);
  });

  const handleAutoLockChange = useCallback(async (seconds: number) => {
    setAutoLockSaving(true);
    setAutoLockError(null);
    try {
      await updateAutoLockSeconds(seconds);
      setAutoLockSeconds(seconds);
      const resolved = await getResolvedConfig();
      setResolvedConfig(resolved);
      setAutoLockSeconds(resolved.autoLockSeconds.value);
      setAutoLockDisabled(resolved.autoLockSeconds.disabled);
    } catch (e) {
      setAutoLockError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoLockSaving(false);
    }
  }, []);

  const saveGitSettings = useCallback(async () => {
    setGitSaving(true);
    setGitError(null);
    setGitSaved(false);
    try {
      const settings = await updateGitSyncSettings(
        gitEnabled,
        remoteUrl.trim() || null,
        sshKeyPath.trim() || null,
      );
      onGitSyncChange?.(settings.gitSync);
      setGitSaved(true);
      globalThis.setTimeout(() => setGitSaved(false), 2000);
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitSaving(false);
    }
  }, [gitEnabled, remoteUrl, sshKeyPath, onGitSyncChange]);

  const saveSshPassphraseToKeyring = useCallback(async () => {
    setSshPassphraseSaving(true);
    setSshPassphraseError(null);
    setSshPassphraseSaved(false);
    try {
      await saveSshPassphrase(sshPassphrase);
      setSshPassphrase("");
      setSshPassphraseSaved(true);
      globalThis.setTimeout(() => setSshPassphraseSaved(false), 3000);
    } catch (e) {
      setSshPassphraseError(e instanceof Error ? e.message : String(e));
    } finally {
      setSshPassphraseSaving(false);
    }
  }, [sshPassphrase]);

  const handleDisableMfa = async () => {
    setMfaDisabling(true);
    setMfaError(null);
    try {
      await disableMFA();
      setMfaEnabled(false);
      setMfaDisableConfirm(false);
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : String(e));
    } finally {
      setMfaDisabling(false);
    }
  };

  const openMfaDialog = () => {
    setMfaDisableConfirm(false);
    setMfaModalOpen(true);
  };

  const handleMfaPrimaryAction = () => {
    if (mfaEnabled) {
      setMfaDisableConfirm(true);
      return;
    }
    openMfaDialog();
  };

  const navLabel = (id: SettingsCategory) => {
    if (id === "general") return t("settings.nav.general");
    if (id === "sync") return t("settings.nav.sync");
    if (id === "security") return t("settings.nav.security");
    return t("settings.nav.users");
  };

  const categoryLocked = vaultLocked && requiresUnlockedVault(category);

  const renderCategoryPanel = () => {
    if (categoryLocked) {
      return <SettingsLockedView onGoToUnlock={onGoToUnlock} />;
    }

    if (category === "general") {
      return (
        <GeneralSettingsPanel
          theme={theme}
          setTheme={setTheme}
          currentLocale={currentLocale}
          onOpenAbout={() => setAboutOpen(true)}
        />
      );
    }

    if (category === "sync") {
      return (
        <SyncSettingsPanel
          gitEnabled={gitEnabled}
          setGitEnabled={setGitEnabled}
          remoteUrl={remoteUrl}
          setRemoteUrl={setRemoteUrl}
          sshKeyPath={sshKeyPath}
          setSshKeyPath={setSshKeyPath}
          sshPassphrase={sshPassphrase}
          setSshPassphrase={setSshPassphrase}
          resolvedConfig={resolvedConfig}
          gitError={gitError}
          gitSaving={gitSaving}
          gitSaved={gitSaved}
          gitSyncing={gitSyncing}
          sshPassphraseSaving={sshPassphraseSaving}
          sshPassphraseSaved={sshPassphraseSaved}
          sshPassphraseError={sshPassphraseError}
          onSaveGit={() => runAsync(saveGitSettings)}
          onSavePassphrase={() => runAsync(saveSshPassphraseToKeyring)}
          onTriggerGitSync={onTriggerGitSync}
        />
      );
    }

    if (category === "users") {
      return <UserManagementPanel />;
    }

    return (
      <SecuritySettingsPanel
        autoLockSeconds={autoLockSeconds}
        autoLockDisabled={autoLockDisabled}
        autoLockSaving={autoLockSaving}
        autoLockError={autoLockError}
        onAutoLockChange={(seconds) => runAsync(() => handleAutoLockChange(seconds))}
        mfaEnabled={mfaEnabled}
        mfaVaultLocked={mfaVaultLocked}
        mfaDisableConfirm={mfaDisableConfirm}
        mfaDisabling={mfaDisabling}
        mfaControlsDisabled={mfaControlsDisabled}
        mfaError={mfaError}
        mfaLoading={mfaLoading}
        onMfaPrimaryAction={handleMfaPrimaryAction}
        onCancelDisable={() => setMfaDisableConfirm(false)}
        onConfirmDisable={() => runAsync(handleDisableMfa)}
        isMultiUser={isMultiUser}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-vault-bg">
      {visibleNav.length > 1 ? (
        <nav
          aria-label={t("settings.title")}
          className="flex w-48 shrink-0 flex-col border-r border-vault-border bg-vault-surface/50 py-4"
        >
          {visibleNav.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategory(id)}
              aria-current={category === id ? "page" : undefined}
              className={`px-4 py-2.5 text-left font-mono text-xs transition ${
                category === id
                  ? "border-r-2 border-vault-accent bg-vault-bg text-vault-accent"
                  : "text-vault-muted hover:bg-vault-bg hover:text-vault-text"
              }`}
            >
              {navLabel(id)}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-vault-border/60 px-6 py-4">
          <VaultButton variant="ghost" size="sm" onClick={onBack}>
            {t("settings.back")}
          </VaultButton>
          <h1 className="font-mono text-sm text-vault-text">{navLabel(category)}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <p className="font-mono text-sm text-vault-muted">{t("common.loading")}</p>
          ) : (
            renderCategoryPanel()
          )}
        </div>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <MfaSetupModal
        open={mfaModalOpen}
        onClose={() => setMfaModalOpen(false)}
        onVerified={() => {
          setMfaEnabled(true);
          setMfaDisableConfirm(false);
          runAsync(refreshMfaStatus);
        }}
      />
    </div>
  );
}

interface GeneralSettingsPanelProps {
  readonly theme: ThemeId;
  readonly setTheme: (theme: ThemeId) => void;
  readonly currentLocale: string;
  readonly onOpenAbout: () => void;
}

function GeneralSettingsPanel({
  theme,
  setTheme,
  currentLocale,
  onOpenAbout,
}: Readonly<GeneralSettingsPanelProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className={UI.sectionLabel}>{t("settings.theme")}</div>
        <div className={`${UI.card} flex flex-col gap-4`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-vault-text">{t("settings.theme")}</span>
              {isThemeId(theme) ? (
                <span className="text-xs text-vault-muted">{t(`theme.${theme}.description`)}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <ThemeSwatch themeId={theme} />
              <select
                id="settings-theme-select"
                value={theme}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isThemeId(next)) {
                    setTheme(next);
                  }
                }}
                className={`${UI.input} w-48 text-sm`}
              >
                {THEME_IDS.map((themeId) => (
                  <option key={themeId} value={themeId}>
                    {t(`theme.${themeId}.label`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={settingsDividerClass} />

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-vault-text">{t("settings.language")}</span>
            </div>
            <select
              id="settings-locale-select"
              value={currentLocale}
              onChange={(e) => {
                const next = e.target.value;
                if (isLocaleId(next)) {
                  changeAppLocale(next);
                }
              }}
              className={`${UI.input} w-48 text-sm`}
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`locale.${option.id}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className={UI.sectionLabel}>{t("about.menuItem")}</div>
        <button
          type="button"
          onClick={onOpenAbout}
          className={`${UI.card} flex w-full items-center gap-4 p-4 text-left transition-shadow duration-150 hover:shadow-md`}
        >
          <AppLogo size="md" className="h-10 w-10 rounded-xl" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-vault-text">{APP_NAME}</span>
            <span className="text-xs text-vault-muted">
              {t("about.version", { version: APP_VERSION_LABEL })} · oxidvault.com
            </span>
          </div>
        </button>
      </section>
    </div>
  );
}

interface SyncSettingsPanelProps {
  readonly gitEnabled: boolean;
  readonly setGitEnabled: (value: boolean) => void;
  readonly remoteUrl: string;
  readonly setRemoteUrl: (value: string) => void;
  readonly sshKeyPath: string;
  readonly setSshKeyPath: (value: string) => void;
  readonly sshPassphrase: string;
  readonly setSshPassphrase: (value: string) => void;
  readonly resolvedConfig: ResolvedConfig | null;
  readonly gitError: string | null;
  readonly gitSaving: boolean;
  readonly gitSaved: boolean;
  readonly gitSyncing: boolean;
  readonly sshPassphraseSaving: boolean;
  readonly sshPassphraseSaved: boolean;
  readonly sshPassphraseError: string | null;
  readonly onSaveGit: () => void;
  readonly onSavePassphrase: () => void;
  readonly onTriggerGitSync?: () => void;
}

function SyncSettingsPanel({
  gitEnabled,
  setGitEnabled,
  remoteUrl,
  setRemoteUrl,
  sshKeyPath,
  setSshKeyPath,
  sshPassphrase,
  setSshPassphrase,
  resolvedConfig,
  gitError,
  gitSaving,
  gitSaved,
  gitSyncing,
  sshPassphraseSaving,
  sshPassphraseSaved,
  sshPassphraseError,
  onSaveGit,
  onSavePassphrase,
  onTriggerGitSync,
}: Readonly<SyncSettingsPanelProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <p className={UI.muted}>{t("settings.gitSyncHint")}</p>
      {resolvedConfig?.adminPolicyActive ? (
        <p className="text-xs text-vault-accent">{t("settings.adminPolicyActive")}</p>
      ) : null}

      <div className={`${UI.card} flex flex-col gap-4`}>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={gitEnabled}
            onChange={(e) => setGitEnabled(e.target.checked)}
            disabled={resolvedConfig?.gitSyncEnabled.disabled ?? false}
            className="rounded border-vault-border bg-vault-bg text-vault-accent focus:ring-vault-accent disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="text-sm text-vault-text">
            {t("settings.syncEnabled")}
            {resolvedConfig?.gitSyncEnabled.disabled ? (
              <span className="ml-1 text-xs text-vault-muted">{t("common.admin")}</span>
            ) : null}
          </span>
        </label>

        <div className={settingsDividerClass} />

        <label htmlFor="settings-git-remote-url" className="block">
          <span className={UI.fieldLabel}>{t("settings.remoteRepository")}</span>
          <input
            id="settings-git-remote-url"
            type="text"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder={t("settings.remotePlaceholder")}
            disabled={!gitEnabled}
            className={inputClass}
          />
        </label>

        <div className={settingsDividerClass} />

        <div className="flex flex-col gap-4">
          <p className={UI.muted}>{t("settings.gitAdvancedHint")}</p>

          <label htmlFor="settings-git-ssh-key-path" className="block">
            <span className={UI.fieldLabel}>{t("settings.sshKeyPath")}</span>
            <input
              id="settings-git-ssh-key-path"
              type="text"
              value={sshKeyPath}
              onChange={(e) => setSshKeyPath(e.target.value)}
              placeholder={t("settings.sshKeyPathPlaceholder")}
              disabled={!gitEnabled}
              className={inputClass}
            />
          </label>

          <div>
            <label htmlFor="settings-git-ssh-passphrase" className="block">
              <span className={UI.fieldLabel}>{t("settings.sshPassphrase")}</span>
              <input
                id="settings-git-ssh-passphrase"
                type="password"
                value={sshPassphrase}
                onChange={(e) => setSshPassphrase(e.target.value)}
                autoComplete="new-password"
                disabled={!gitEnabled}
                className={inputClass}
              />
            </label>
            <p className={`${UI.muted} mt-1.5`}>{t("settings.sshPassphraseHint")}</p>
            {sshPassphraseSaved ? (
              <p className={`${STATUS_SUCCESS_CLASS} mt-2 px-2 py-1 text-xs`}>
                {t("settings.sshPassphraseSaved")}
              </p>
            ) : null}
            {sshPassphraseError ? (
              <p className="mt-2 text-xs text-vault-danger" role="alert">
                {sshPassphraseError}
              </p>
            ) : null}
            <VaultButton
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onSavePassphrase}
              disabled={!gitEnabled || sshPassphraseSaving}
            >
              {sshPassphraseSaveButtonLabel(sshPassphraseSaving, sshPassphraseSaved, t)}
            </VaultButton>
          </div>
        </div>
      </div>

      {gitError ? (
        <p className="text-xs text-vault-danger" role="alert">
          {gitError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <VaultButton
          variant="outline"
          size="sm"
          onClick={onTriggerGitSync}
          disabled={!gitEnabled || gitSyncing || !onTriggerGitSync}
        >
          {gitSyncing ? t("sync.syncing") : t("sync.syncGit")}
        </VaultButton>
        <VaultButton variant="primary" size="sm" onClick={onSaveGit} disabled={gitSaving}>
          {gitSaveButtonLabel(gitSaving, gitSaved, t)}
        </VaultButton>
      </div>
    </div>
  );
}

interface SecuritySettingsPanelProps {
  readonly autoLockSeconds: number;
  readonly autoLockDisabled: boolean;
  readonly autoLockSaving: boolean;
  readonly autoLockError: string | null;
  readonly onAutoLockChange: (seconds: number) => void;
  readonly mfaEnabled: boolean;
  readonly mfaVaultLocked: boolean;
  readonly mfaDisableConfirm: boolean;
  readonly mfaDisabling: boolean;
  readonly mfaControlsDisabled: boolean;
  readonly mfaError: string | null;
  readonly mfaLoading: boolean;
  readonly onMfaPrimaryAction: () => void;
  readonly onCancelDisable: () => void;
  readonly onConfirmDisable: () => void;
  readonly isMultiUser?: boolean;
}

function SecuritySettingsPanel({
  autoLockSeconds,
  autoLockDisabled,
  autoLockSaving,
  autoLockError,
  onAutoLockChange,
  mfaEnabled,
  mfaVaultLocked,
  mfaDisableConfirm,
  mfaDisabling,
  mfaControlsDisabled,
  mfaError,
  mfaLoading,
  onMfaPrimaryAction,
  onCancelDisable,
  onConfirmDisable,
  isMultiUser = false,
}: Readonly<SecuritySettingsPanelProps>) {
  const { t } = useTranslation();

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="vault-card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-vault-text">{t("settings.autoLock.title")}</span>
            <span className="text-xs text-vault-muted">{t("settings.autoLock.description")}</span>
            {autoLockDisabled ? (
              <span className="mt-0.5 text-xs text-vault-warning">{t("settings.adminPolicy")}</span>
            ) : null}
          </div>
          <select
            className={`${UI.input} w-48 text-sm`}
            value={autoLockSeconds}
            onChange={(e) => onAutoLockChange(Number(e.target.value))}
            disabled={autoLockDisabled || autoLockSaving}
          >
            {autoLockSelectOptions(autoLockSeconds, t).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {autoLockError ? (
          <p className="text-xs text-vault-danger" role="alert">
            {autoLockError}
          </p>
        ) : null}
      </div>

      <div className="vault-card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-vault-text">{t("settings.mfa.title")}</span>
            <span className="text-xs text-vault-muted">{t("settings.mfa.modalHint")}</span>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              mfaEnabled
                ? "bg-vault-success-subtle text-vault-success"
                : "border border-vault-border bg-vault-bg text-vault-muted"
            }`}
          >
            {mfaEnabled ? `✓ ${t("settings.mfa.statusEnabled")}` : t("common.no")}
          </span>
        </div>

        <div className="border-t border-vault-border" />

        {mfaEnabled ? null : (
          <p className="text-xs leading-relaxed text-vault-muted" role="note">
            {t("settings.mfa.recoveryHint")}
          </p>
        )}

        {mfaVaultLocked ? (
          <p className="text-xs text-vault-muted">{t("settings.mfa.vaultLockedHint")}</p>
        ) : null}

        {mfaDisableConfirm ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-vault-muted">
              {t("settings.mfa.disableConfirm")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelDisable}
                disabled={mfaDisabling}
                className="vault-btn-ghost px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={onConfirmDisable}
                disabled={mfaDisabling}
                className="vault-btn-danger px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {mfaDisabling ? t("settings.mfa.disabling") : t("settings.mfa.disableConfirmAction")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onMfaPrimaryAction}
            disabled={mfaControlsDisabled}
            className={`self-start px-3 py-1.5 text-sm disabled:opacity-50 ${
              mfaEnabled ? "vault-btn-danger" : "vault-btn-primary"
            }`}
          >
            {mfaButtonLabel(mfaLoading, mfaEnabled, t)}
          </button>
        )}

        {mfaError ? (
          <p className="text-xs text-vault-danger" role="alert">
            {mfaError}
          </p>
        ) : null}
      </div>

      {isMultiUser ? <ChangeUserPasswordPanel /> : null}
    </div>
  );
}

function autoLockSelectOptions(
  currentValue: number,
  t: (key: string, options?: { seconds: number }) => string,
): Array<{ value: number; label: string }> {
  const presets: Array<{ value: number; label: string }> = AUTO_LOCK_PRESETS.map(
    (seconds) => ({
      value: seconds,
      label: autoLockPresetLabel(seconds, t),
    }),
  );

  if (!(AUTO_LOCK_PRESETS as readonly number[]).includes(currentValue)) {
    presets.unshift({
      value: currentValue,
      label: t("settings.autoLock.customSeconds", { seconds: currentValue }),
    });
  }

  return presets;
}

function autoLockPresetLabel(
  seconds: number,
  t: (key: string) => string,
): string {
  if (seconds === 0) return t("settings.autoLock.never");
  if (seconds === 60) return t("settings.autoLock.1min");
  if (seconds === 300) return t("settings.autoLock.5min");
  if (seconds === 600) return t("settings.autoLock.10min");
  if (seconds === 900) return t("settings.autoLock.15min");
  if (seconds === 1800) return t("settings.autoLock.30min");
  return String(seconds);
}

function gitSaveButtonLabel(
  saving: boolean,
  saved: boolean,
  t: (key: string) => string,
): string {
  if (saving) return t("settings.saving");
  if (saved) return t("settings.saved");
  return t("settings.saveGit");
}

function sshPassphraseSaveButtonLabel(
  saving: boolean,
  saved: boolean,
  t: (key: string) => string,
): string {
  if (saving) return t("settings.saving");
  if (saved) return t("settings.sshPassphraseSaved");
  return t("settings.saveSshPassphrase");
}

function mfaButtonLabel(
  loading: boolean,
  enabled: boolean,
  t: (key: string) => string,
): string {
  if (loading) return t("settings.mfa.loading");
  if (enabled) return t("settings.mfa.disable");
  return t("settings.mfa.enable");
}
