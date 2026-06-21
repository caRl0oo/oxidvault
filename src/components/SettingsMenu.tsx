import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { getAppSettings, getResolvedConfig, updateGitSyncSettings } from "@/lib/ipc";
import { THEME_OPTIONS, isThemeId } from "@/lib/theme";
import type { GitSyncSettings } from "@/types/settings";
import type { ResolvedConfig } from "@/types/policy";

interface SettingsMenuProps {
  readonly onGitSyncChange?: (settings: GitSyncSettings) => void;
}

export function SettingsMenu({ onGitSyncChange }: Readonly<SettingsMenuProps>) {
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
    void Promise.all([getAppSettings(), getResolvedConfig()])
      .then(([settings, resolved]) => {
        setResolvedConfig(resolved);
        setGitEnabled(resolved.gitSyncEnabled.value);
        setRemoteUrl(settings.gitSync.remoteUrl ?? "");
        onGitSyncChange?.({
          enabled: resolved.gitSyncEnabled.value,
          remoteUrl: settings.gitSync.remoteUrl,
        });
      })
      .catch(() => {
        /* settings optional on first run */
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
      globalThis .setTimeout(() => setGitSaved(false), 2000);
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitSaving(false);
    }
  }, [gitEnabled, remoteUrl, onGitSyncChange]);

  const current = THEME_OPTIONS.find((t) => t.id === theme);
  const gitSaveLabel = gitSaveButtonLabel(gitSaving, gitSaved);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Einstellungen"
        title="Einstellungen"
        className="rounded border border-vault-border p-1.5 text-vault-muted transition hover:border-vault-accent hover:text-vault-accent"
      >
        <GearIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          aria-label="Einstellungen"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-vault-border bg-vault-surface shadow-xl"
        >
          <div className="border-b border-vault-border px-3 py-3">
            <label
              htmlFor="theme-select"
              className="font-mono text-[10px] uppercase tracking-wider text-vault-muted"
            >
              Design
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
                {THEME_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {current && (
              <p className="mt-1 pl-5 font-mono text-[10px] text-vault-muted">{current.description}</p>
            )}
          </div>

          <div className="border-t border-vault-border px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-vault-muted">
              Git Synchronisation
            </p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-vault-muted">
              Die verschlüsselte .oxid-Datei wird über Git synchronisiert — Klartext-Secrets
              verlassen nie den Tresor.
            </p>
            {resolvedConfig?.adminPolicyActive && (
              <p className="mt-2 font-mono text-[10px] text-vault-accent">
                Admin-Richtlinie aktiv — einige Optionen sind gesperrt.
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
                Sync aktiv
                {resolvedConfig?.gitSyncEnabled.disabled && (
                  <span className="ml-1 text-[10px] text-vault-muted">(Admin)</span>
                )}
              </span>
            </label>

            <label className="mt-2 block">
              <span className="font-mono text-[10px] text-vault-muted">Remote-Repository</span>
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/vault.git"
                disabled={!gitEnabled}
                className="mt-1 w-full rounded border border-vault-border bg-vault-bg px-2 py-1.5 font-mono text-xs text-vault-text placeholder:text-vault-muted focus:border-vault-accent disabled:opacity-50"
              />
            </label>

            {gitError && (
              <p className="mt-2 font-mono text-[10px] text-vault-danger">{gitError}</p>
            )}

            <button
              type="button"
              onClick={() => void saveGitSettings()}
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

function gitSaveButtonLabel(saving: boolean, saved: boolean): string {
  if (saving) return "Speichern…";
  if (saved) return "Gespeichert ✓";
  return "Git-Einstellungen speichern";
}

function ThemeSwatch({ themeId }: Readonly<{ themeId: string }>) {
  const colors: Record<string, [string, string]> = {
    oxid: ["#3b82f6", "#12141a"],
    dracula: ["#bd93f9", "#282a36"],
    nord: ["#88c0d0", "#2e3440"],
    matrix: ["#00ff41", "#0d0d0d"],
  };
  const [accent, bg] = colors[themeId] ?? colors.oxid;
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-vault-border"
      style={{ background: `linear-gradient(135deg, ${accent} 50%, ${bg} 50%)` }}
      aria-hidden
    />
  );
}

function GearIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
