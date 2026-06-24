import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutModal } from "@/components/AboutModal";
import { MfaSetupModal } from "@/components/MfaSetupModal";
import { VaultButton } from "@/components/ui/VaultButton";
import { ThemeSwatch } from "@/components/ui/ThemeSwatch";
import { useTheme } from "@/hooks/useTheme";
import { changeAppLocale } from "@/lib/i18n";
import {
  disableMFA,
  getAppSettings,
  getMfaStatus,
  getResolvedConfig,
  saveSshPassphrase,
  updateGitSyncSettings,
} from "@/lib/ipc";
import { LOCALE_OPTIONS, isLocaleId } from "@/lib/locale";
import { runAsync } from "@/lib/runAsync";
import { THEME_IDS, isThemeId, type ThemeId } from "@/lib/theme";
import { CONFIRM_PANEL_CLASS, NOTE_PANEL_CLASS, STATUS_SUCCESS_CLASS } from "@/lib/uiClasses";
import type { GitSyncSettings } from "@/types/settings";
import type { ResolvedConfig } from "@/types/policy";
import type { SettingsCategory } from "@/components/settings/types";
import { requiresUnlockedVault } from "@/components/settings/types";
import { SettingsLockedView } from "@/components/settings/SettingsLockedView";

const SETTINGS_NAV: SettingsCategory[] = ["general", "sync", "security"];

const inputClass =
  "mt-1.5 w-full max-w-xl rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm text-vault-text placeholder:text-vault-muted focus:border-vault-accent disabled:opacity-50";

interface SettingsViewProps {
  readonly initialCategory?: SettingsCategory;
  readonly vaultLocked: boolean;
  readonly onBack: () => void;
  readonly onGoToUnlock: () => void;
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
  readonly onTriggerGitSync?: () => void;
  readonly gitSyncing?: boolean;
}

export function SettingsView({
  initialCategory = "general",
  vaultLocked,
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
  const [loading, setLoading] = useState(true);

  const currentLocale = isLocaleId(i18n.language) ? i18n.language : i18n.language.split("-")[0];
  const mfaControlsDisabled = mfaVaultLocked || mfaLoading || mfaDisabling;

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

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
        const [settings, resolved, status] = await Promise.all([
          getAppSettings(),
          getResolvedConfig(),
          getMfaStatus(),
        ]);
        setResolvedConfig(resolved);
        setGitEnabled(resolved.gitSyncEnabled.value);
        setRemoteUrl(settings.gitSync.remoteUrl ?? "");
        setSshKeyPath(settings.gitSync.sshKeyPath ?? "");
        setSshPassphrase("");
        setMfaEnabled(status.mfaEnabled);
        setMfaVaultLocked(status.vaultLocked);
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
  }, [onGitSyncChange]);

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
    return t("settings.nav.security");
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

    return (
      <SecuritySettingsPanel
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
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-vault-bg">
      <nav
        aria-label={t("settings.title")}
        className="flex w-48 shrink-0 flex-col border-r border-vault-border bg-vault-surface/50 py-4"
      >
        {SETTINGS_NAV.map((id) => (
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
    <div className="max-w-xl space-y-8">
      <section>
        <h2 className="font-mono text-xs uppercase tracking-wider text-vault-muted">
          {t("settings.theme")}
        </h2>
        <div className="mt-3 flex items-center gap-3">
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
            className={inputClass}
          >
            {THEME_IDS.map((themeId) => (
              <option key={themeId} value={themeId}>
                {t(`theme.${themeId}.label`)}
              </option>
            ))}
          </select>
        </div>
        {isThemeId(theme) && (
          <p className="mt-2 font-mono text-xs text-vault-muted">
            {t(`theme.${theme}.description`)}
          </p>
        )}
      </section>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-wider text-vault-muted">
          {t("settings.language")}
        </h2>
        <select
          id="settings-locale-select"
          value={currentLocale}
          onChange={(e) => {
            const next = e.target.value;
            if (isLocaleId(next)) {
              changeAppLocale(next);
            }
          }}
          className={inputClass}
        >
          {LOCALE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {t(`locale.${option.id}`)}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-wider text-vault-muted">
          {t("about.menuItem")}
        </h2>
        <VaultButton variant="outline" size="sm" className="mt-3" onClick={onOpenAbout}>
          {t("about.menuItem")}
        </VaultButton>
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
    <div className="max-w-xl space-y-6">
      <p className="font-mono text-xs leading-relaxed text-vault-muted">{t("settings.gitSyncHint")}</p>
      {resolvedConfig?.adminPolicyActive && (
        <p className="font-mono text-xs text-vault-accent">{t("settings.adminPolicyActive")}</p>
      )}

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={gitEnabled}
          onChange={(e) => setGitEnabled(e.target.checked)}
          disabled={resolvedConfig?.gitSyncEnabled.disabled ?? false}
          className="rounded border-vault-border bg-vault-bg text-vault-accent focus:ring-vault-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="font-mono text-sm text-vault-text">
          {t("settings.syncEnabled")}
          {resolvedConfig?.gitSyncEnabled.disabled && (
            <span className="ml-1 text-xs text-vault-muted">{t("common.admin")}</span>
          )}
        </span>
      </label>

      <label htmlFor="settings-git-remote-url" className="block">
        <span className="font-mono text-xs text-vault-muted">{t("settings.remoteRepository")}</span>
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

      <section className="space-y-4 rounded-lg border border-vault-border/60 bg-vault-surface/30 p-4">
        <p className="font-mono text-xs leading-relaxed text-vault-muted">
          {t("settings.gitAdvancedHint")}
        </p>

        <label htmlFor="settings-git-ssh-key-path" className="block">
          <span className="font-mono text-xs text-vault-muted">{t("settings.sshKeyPath")}</span>
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
            <span className="font-mono text-xs text-vault-muted">{t("settings.sshPassphrase")}</span>
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
          <p className="mt-1.5 font-mono text-xs leading-relaxed text-vault-muted">
            {t("settings.sshPassphraseHint")}
          </p>
          {sshPassphraseSaved && (
            <p className={`${STATUS_SUCCESS_CLASS} mt-2 px-2 py-1 text-xs`}>
              {t("settings.sshPassphraseSaved")}
            </p>
          )}
          {sshPassphraseError && (
            <p className="mt-2 font-mono text-xs text-vault-danger" role="alert">
              {sshPassphraseError}
            </p>
          )}
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
      </section>

      {gitError && (
        <p className="font-mono text-xs text-vault-danger" role="alert">
          {gitError}
        </p>
      )}

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
}

function SecuritySettingsPanel({
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
}: Readonly<SecuritySettingsPanelProps>) {
  const { t } = useTranslation();

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="font-mono text-xs uppercase tracking-wider text-vault-muted">
        {t("settings.mfa.title")}
      </h2>

      {mfaEnabled && (
        <p className={`${STATUS_SUCCESS_CLASS} px-3 py-2 text-xs`}>
          {t("settings.mfa.statusEnabled")}
        </p>
      )}

      {!mfaEnabled && (
        <p className={`${NOTE_PANEL_CLASS} px-3 py-2 text-xs leading-relaxed`} role="note">
          {t("settings.mfa.recoveryHint")}
        </p>
      )}

      {mfaVaultLocked && (
        <p className="font-mono text-xs text-vault-muted">{t("settings.mfa.vaultLockedHint")}</p>
      )}

      {mfaDisableConfirm ? (
        <div className={`${CONFIRM_PANEL_CLASS} p-4`}>
          <p className="font-mono text-xs leading-relaxed text-vault-muted">
            {t("settings.mfa.disableConfirm")}
          </p>
          <div className="mt-3 flex gap-2">
            <VaultButton variant="ghost" size="sm" onClick={onCancelDisable} disabled={mfaDisabling}>
              {t("common.cancel")}
            </VaultButton>
            <VaultButton
              variant="outline"
              tone="danger"
              size="sm"
              onClick={onConfirmDisable}
              disabled={mfaDisabling}
            >
              {mfaDisabling ? t("settings.mfa.disabling") : t("settings.mfa.disableConfirmAction")}
            </VaultButton>
          </div>
        </div>
      ) : (
        <VaultButton
          variant={mfaEnabled ? "outline" : "primary"}
          size="sm"
          onClick={onMfaPrimaryAction}
          disabled={mfaControlsDisabled}
        >
          {mfaButtonLabel(mfaLoading, mfaEnabled, t)}
        </VaultButton>
      )}

      {mfaError && (
        <p className="font-mono text-xs text-vault-danger" role="alert">
          {mfaError}
        </p>
      )}
    </div>
  );
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
