// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppLogo } from "@/components/AppLogo";
import { GitSyncStatusIndicator } from "@/components/GitSyncStatusIndicator";
import { GearIcon } from "@/components/ui/GearIcon";
import { UI } from "@/lib/uiClasses";

const ICON_CLASS = "h-3.5 w-3.5";

function MinimizeIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 3.5h6.5V10M4.5 6H11v6.5H4.5V6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface TitleBarButtonProps {
  readonly ariaLabel: string;
  readonly onClick: () => void;
  readonly variant?: "default" | "close";
  readonly children: ReactNode;
}

function TitleBarButton({
  ariaLabel,
  onClick,
  variant = "default",
  children,
}: Readonly<TitleBarButtonProps>) {
  const hoverClass =
    variant === "close"
      ? "text-vault-muted hover:bg-vault-danger hover:text-white"
      : "text-vault-muted hover:bg-vault-hover-overlay hover:text-vault-text";

  return (
    <button
      type="button"
      className={`pointer-events-auto flex h-full w-9 items-center justify-center border-0 bg-transparent transition-colors ${hoverClass}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

interface TitleBarProps {
  readonly vaultStatus?: ReactNode;
  readonly vaultLocked?: boolean;
  readonly gitSyncEnabled?: boolean;
  readonly gitSyncing?: boolean;
  readonly gitSyncError?: string | null;
  readonly onOpenGitSettings?: () => void;
  readonly onOpenSettings?: () => void;
}

export function TitleBar({
  vaultStatus,
  vaultLocked = false,
  gitSyncEnabled = false,
  gitSyncing = false,
  gitSyncError = null,
  onOpenGitSettings,
  onOpenSettings,
}: Readonly<TitleBarProps>) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  const appWindow = useMemo(() => getCurrentWindow(), []);

  const showHeaderGitSync = !vaultLocked && gitSyncEnabled && !!onOpenGitSettings;
  const hideVaultStatusGitSync = showHeaderGitSync || vaultLocked;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      if (!cancelled) {
        setMaximized(await appWindow.isMaximized());
      }
      unlisten = await appWindow.onResized(async () => {
        if (!cancelled) {
          setMaximized(await appWindow.isMaximized());
        }
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <div
      data-tauri-drag-region
      className="relative z-[110] flex h-9 shrink-0 select-none items-stretch border-b border-vault-border bg-vault-elevated"
      style={{
        boxShadow: "var(--shadow-sm), inset 0 -1px 0 var(--color-vault-border)",
        borderTop: "1px solid color-mix(in srgb, var(--color-vault-accent) 25%, transparent)",
      }}
    >
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2 px-3">
        <AppLogo size="sm" className="h-4 w-4" />
        <span className="truncate text-xs font-medium text-vault-text">{t("common.appName")}</span>
      </div>

      <div className="pointer-events-auto flex h-full shrink-0 items-center gap-2 pr-1">
        <div className="flex items-center gap-2">
          {showHeaderGitSync ? (
            <GitSyncStatusIndicator
              syncing={gitSyncing}
              syncError={gitSyncError}
              onOpenSettings={onOpenGitSettings!}
            />
          ) : null}

          {vaultStatus ? (
            <div
              className={[
                hideVaultStatusGitSync
                  ? "[&>div>button:first-child]:hidden [&>div>div]:border-l-0 [&>div>div]:pl-0"
                  : "",
                // Non-interactive descendants must be transparent so the drag region can be hit.
                "pointer-events-none [&_*]:pointer-events-none [&_button]:pointer-events-auto",
              ].join(" ")}
            >
              {vaultStatus}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className={`${UI.btnGhost} pointer-events-auto p-1.5`}
            aria-label={t("settings.title")}
            title={t("settings.title")}
          >
            <GearIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-none mx-1 h-5 w-px bg-vault-border/40" />

        <div className="flex h-full items-stretch">
          <TitleBarButton
            ariaLabel={t("titlebar.minimize")}
            onClick={() => {
              void appWindow.minimize();
            }}
          >
            <MinimizeIcon />
          </TitleBarButton>
          <TitleBarButton
            ariaLabel={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
            onClick={() => {
              void appWindow.toggleMaximize();
            }}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </TitleBarButton>
          <TitleBarButton
            ariaLabel={t("titlebar.close")}
            variant="close"
            onClick={() => {
              void appWindow.close();
            }}
          >
            <CloseIcon />
          </TitleBarButton>
        </div>
      </div>
    </div>
  );
}
