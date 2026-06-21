import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GearIcon } from "@/components/ui/GearIcon";
import { ThemeSwatch } from "@/components/ui/ThemeSwatch";
import { useTheme } from "@/hooks/useTheme";
import { changeAppLocale } from "@/lib/i18n";
import { getAppSettings, getResolvedConfig, updateGitSyncSettings } from "@/lib/ipc";
import { LOCALE_OPTIONS, isLocaleId } from "@/lib/locale";
import { runAsync } from "@/lib/runAsync";
import { THEME_IDS, isThemeId } from "@/lib/theme";
import type { GitSyncSettings } from "@/types/settings";
import type { ResolvedConfig } from "@/types/policy";

interface SettingsMenuProps {
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
}

export function SettingsMenu({ onGitSyncChange }: Readonly<SettingsMenuProps>) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const [gitEnabled, setGitEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [gitSaving, setGitSaving] = useState(false);
  const [gitSaved, setGitSaved] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [resolvedConfig, setResolvedConfig] = useState<ResolvedConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    runAsync(async () => {
      const [settings, resolved] = await Promise.all([getAppSettings(), getResolvedConfig()]);
      setResolvedConfig(resolved);
      setGitEnabled(resolved.gitSyncEnabled.value);
      setRemoteUrl(settings.gitSync.remoteUrl ?? "");
      onGitSyncChange?.({
        enabled: resolved.gitSyncEnabled.value,
        remoteUrl: settings.gitSync.remoteUrl,
      });
    });
  }, [open, onGitSyncChange]);

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

  const currentThemeId = theme;
  const gitSaveLabel = gitSaveButtonLabel(t, gitSaving, gitSaved);
  const currentLocale = isLocaleId(i18n.language) ? i18n.language : i18n.language.split("-")[0];

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
              className="mt-3 w-full rounded bg-vault-accent py-1.5 font-mono text-xs text-white hover:bg-vault-accent-hover disabled:opacity-50"
            >
              {gitSaveLabel}
            </button>
          </div>
        </div>
      )}
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
