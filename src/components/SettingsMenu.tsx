import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GearIcon } from "@/components/ui/GearIcon";
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
  updateGitSyncSettings,
} from "@/lib/ipc";
import { LOCALE_OPTIONS, isLocaleId } from "@/lib/locale";
import { runAsync } from "@/lib/runAsync";
import { THEME_IDS, isThemeId } from "@/lib/theme";
import { CONFIRM_PANEL_CLASS, NOTE_PANEL_CLASS, STATUS_SUCCESS_CLASS } from "@/lib/uiClasses";
import type { GitSyncSettings } from "@/types/settings";
import type { ResolvedConfig } from "@/types/policy";

interface SettingsMenuProps {
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
}

export function SettingsMenu({ onGitSyncChange }: Readonly<SettingsMenuProps>) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaVaultLocked, setMfaVaultLocked] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaDisableConfirm, setMfaDisableConfirm] = useState(false);
  const [mfaDisabling, setMfaDisabling] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const [gitEnabled, setGitEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [gitSaving, setGitSaving] = useState(false);
  const [gitSaved, setGitSaved] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedConfig | null>(null);

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
    if (!open) return;
    runAsync(async () => {
      setMfaLoading(true);
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
        setMfaEnabled(status.mfaEnabled);
        setMfaVaultLocked(status.vaultLocked);
        onGitSyncChange?.({
          enabled: resolved.gitSyncEnabled.value,
          remoteUrl: settings.gitSync.remoteUrl,
        });
      } catch (e) {
        setMfaError(e instanceof Error ? e.message : String(e));
      } finally {
        setMfaLoading(false);
      }
    });
  }, [open, onGitSyncChange]);

  useEffect(() => {
    if (!open) {
      setMfaDisableConfirm(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const saveGitSettings = useCallback(async () => {
    setGitSaving(true);
    setGitError(null);
    setGitSaved(false);
    try {
      const settings = await updateGitSyncSettings(gitEnabled, remoteUrl.trim() || null);
      onGitSyncChange?.(settings.gitSync);
      setGitSaved(true);
      globalThis.setTimeout(() => setGitSaved(false), 2000);
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitSaving(false);
    }
  }, [gitEnabled, remoteUrl, onGitSyncChange]);

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

  const currentThemeId = theme;
  const gitSaveLabel = gitSaveButtonLabel(t, gitSaving, gitSaved);
  const currentLocale = isLocaleId(i18n.language) ? i18n.language : i18n.language.split("-")[0];
  const mfaControlsDisabled = mfaVaultLocked || mfaLoading || mfaDisabling;

  const openAboutDialog = () => {
    setOpen(false);
    setAboutOpen(true);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("settings.title")}
        title={t("settings.title")}
        className="rounded border border-vault-border p-1.5 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent"
      >
        <GearIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          aria-label={t("settings.title")}
          className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl"
        >
          <div className="border-b border-vault-border px-3 py-3">
            <label
              htmlFor="theme-select"
              className="font-mono text-[10px] uppercase tracking-wider text-vault-muted"
            >
              {t("settings.theme")}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <ThemeSwatch themeId={theme} />
              <select
                id="theme-select"
                value={theme}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isThemeId(next)) {
                    setTheme(next);
                  }
                }}
                className="w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs text-vault-text focus:border-vault-accent"
              >
                {THEME_IDS.map((themeId) => (
                  <option key={themeId} value={themeId}>
                    {t(`theme.${themeId}.label`)}
                  </option>
                ))}
              </select>
            </div>
            {currentThemeId && (
              <p className="mt-1 pl-5 font-mono text-[10px] text-vault-muted">
                {t(`theme.${currentThemeId}.description`)}
              </p>
            )}
          </div>

          <div className="border-b border-vault-border px-3 py-3">
            <label
              htmlFor="locale-select"
              className="font-mono text-[10px] uppercase tracking-wider text-vault-muted"
            >
              {t("settings.language")}
            </label>
            <select
              id="locale-select"
              value={currentLocale}
              onChange={(e) => {
                const next = e.target.value;
                if (isLocaleId(next)) {
                  changeAppLocale(next);
                }
              }}
              className="mt-2 w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs text-vault-text focus:border-vault-accent"
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`locale.${option.id}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-vault-border px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("settings.gitSync")}
            </p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-vault-muted">
              {t("settings.gitSyncHint")}
            </p>
            {resolvedConfig?.adminPolicyActive && (
              <p className="mt-2 font-mono text-[10px] text-vault-accent">
                {t("settings.adminPolicyActive")}
              </p>
            )}

            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={gitEnabled}
                onChange={(e) => setGitEnabled(e.target.checked)}
                disabled={resolvedConfig?.gitSyncEnabled.disabled ?? false}
                className="rounded border-vault-border bg-vault-bg text-vault-accent focus:ring-vault-accent disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="font-mono text-xs text-vault-text">
                {t("settings.syncEnabled")}
                {resolvedConfig?.gitSyncEnabled.disabled && (
                  <span className="ml-1 text-[10px] text-vault-muted">{t("common.admin")}</span>
                )}
              </span>
            </label>

            <label htmlFor="git-remote-url" className="mt-2 block">
              <span className="font-mono text-[10px] text-vault-muted">
                {t("settings.remoteRepository")}
              </span>
              <input
                id="git-remote-url"
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder={t("settings.remotePlaceholder")}
                disabled={!gitEnabled}
                className="mt-1 w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs text-vault-text placeholder:text-vault-muted focus:border-vault-accent disabled:opacity-50"
              />
            </label>

            {gitError && (
              <p className="mt-2 font-mono text-[10px] text-vault-danger">{gitError}</p>
            )}

            <button
              type="button"
              onClick={() => runAsync(saveGitSettings)}
              disabled={gitSaving}
              className="mt-3 w-full rounded bg-vault-accent py-1.5 font-mono text-xs text-vault-on-accent hover:bg-vault-accent-hover disabled:opacity-50"
            >
              {gitSaveLabel}
            </button>
          </div>

          <div className="border-t border-vault-border px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              {t("settings.mfa.title")}
            </p>

            {mfaEnabled && (
              <p className={`${STATUS_SUCCESS_CLASS} mt-2 px-2 py-1 text-[10px]`}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vault-success" />
                {t("settings.mfa.statusEnabled")}
              </p>
            )}

            {!mfaEnabled && (
              <p
                className={`${NOTE_PANEL_CLASS} mt-2 px-2.5 py-2 text-[10px] leading-relaxed`}
                role="note"
              >
                {t("settings.mfa.recoveryHint")}
              </p>
            )}

            {mfaVaultLocked && (
              <p className="mt-2 font-mono text-[10px] text-vault-muted">
                {t("settings.mfa.vaultLockedHint")}
              </p>
            )}

            {mfaDisableConfirm ? (
              <div className={`${CONFIRM_PANEL_CLASS} mt-3 p-2.5`}>
                <p className="font-mono text-[10px] leading-relaxed text-vault-muted">
                  {t("settings.mfa.disableConfirm")}
                </p>
                <div className="mt-2 flex gap-2">
                  <VaultButton
                    variant="ghost"
                    size="sm"
                    fullWidth
                    onClick={() => setMfaDisableConfirm(false)}
                    disabled={mfaDisabling}
                  >
                    {t("common.cancel")}
                  </VaultButton>
                  <VaultButton
                    variant="outline"
                    tone="danger"
                    size="sm"
                    fullWidth
                    onClick={() => runAsync(handleDisableMfa)}
                    disabled={mfaDisabling}
                  >
                    {mfaDisabling ? t("settings.mfa.disabling") : t("settings.mfa.disableConfirmAction")}
                  </VaultButton>
                </div>
              </div>
            ) : (
              <VaultButton
                variant={mfaEnabled ? "outline" : "primary"}
                fullWidth
                className="mt-3"
                onClick={handleMfaPrimaryAction}
                disabled={mfaControlsDisabled}
              >
                {mfaButtonLabel(t, mfaLoading, mfaEnabled)}
              </VaultButton>
            )}

            {mfaError && (
              <p className="mt-2 font-mono text-[10px] text-vault-danger" role="alert">
                {mfaError}
              </p>
            )}
          </div>

          <div className="border-t border-vault-border px-3 py-2">
            <button
              type="button"
              onClick={openAboutDialog}
              className="w-full rounded px-2 py-2 text-left font-mono text-xs text-vault-muted transition hover:bg-vault-bg hover:text-vault-text"
            >
              {t("about.menuItem")}
            </button>
          </div>
        </div>
      )}

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

function gitSaveButtonLabel(
  t: (key: string) => string,
  saving: boolean,
  saved: boolean,
): string {
  if (saving) return t("settings.saving");
  if (saved) return t("settings.saved");
  return t("settings.saveGit");
}

function mfaButtonLabel(
  t: (key: string) => string,
  loading: boolean,
  enabled: boolean,
): string {
  if (loading) return t("settings.mfa.loading");
  if (enabled) return t("settings.mfa.disable");
  return t("settings.mfa.enable");
}
