// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SshDisconnectConfirmationModal } from "@/components/SshDisconnectConfirmationModal";
import { SshSessionStatusDot } from "@/components/SshSessionStatusDot";
import { readClipboardText } from "@/lib/ipc";
import {
  mountTerminalSession,
  scheduleLayoutSync,
  type TerminalRuntime,
} from "@/lib/sshTerminalSession";
import { sshWrite } from "@/lib/ssh";
import type { SshSessionStatus, SshTerminalState } from "@/types/ssh";
import "@xterm/xterm/css/xterm.css";

interface SshTerminalPanelProps {
  readonly state: SshTerminalState;
  readonly status: SshSessionStatus;
  readonly focusMode: boolean;
  readonly layoutKey: string;
  readonly onToggleFocusMode: () => void;
  readonly onClose: () => void;
  readonly onSessionActive: () => void;
  readonly onSessionEnded: () => void;
}

export function SshTerminalPanel({
  state,
  status,
  focusMode,
  layoutKey,
  onToggleFocusMode,
  onClose,
  onSessionActive,
  onSessionEnded,
}: Readonly<SshTerminalPanelProps>) {
  const { t } = useTranslation();
  const DEBUG_CLIPBOARD = import.meta.env.DEV;
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<TerminalRuntime | null>(null);
  const sessionIdRef = useRef(state.session.sessionId);
  const clipboardHandlersRef = useRef<{
    target: HTMLElement;
    onContextMenu: (event: MouseEvent) => void;
    onMouseUp: (event: MouseEvent) => void;
  } | null>(null);
  const onSessionEndedRef = useRef(onSessionEnded);
  const onSessionActiveRef = useRef(onSessionActive);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  useEffect(() => {
    sessionIdRef.current = state.session.sessionId;
  }, [state.session.sessionId]);

  const pasteFromClipboard = async (): Promise<void> => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;

    let text = "";
    try {
      text = await readClipboardText();
    } catch (err) {
      console.error("[ssh][paste] read_clipboard_text failed:", err);
      return;
    }

    if (DEBUG_CLIPBOARD) {
      console.debug("[ssh][paste] sessionId present:", Boolean(currentSessionId), "len:", text.length);
    }

    if (!text) return;

    try {
      await sshWrite(currentSessionId, text);
    } catch (err) {
      console.error("[ssh][paste] ssh_write failed:", err);
    }
  };

  onSessionEndedRef.current = onSessionEnded;
  onSessionActiveRef.current = onSessionActive;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cleanup = mountTerminalSession({
      container,
      panel: panelRef.current,
      containerRef,
      state,
      onSessionEnded: () => onSessionEndedRef.current(),
      onSessionActive: () => onSessionActiveRef.current(),
      runtimeRef,
    });

    const term = runtimeRef.current?.term;
    const target = (term as unknown as { element?: HTMLElement }).element ?? container;

    if (term && target) {
      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (DEBUG_CLIPBOARD) {
          console.debug("[ssh][paste] contextmenu handler fired");
        }
      };

      const onMouseUp = (event: MouseEvent) => {
        if (event.button !== 2) return; // right click only
        event.preventDefault();
        event.stopPropagation();

        void (async () => {
          const selection = term.getSelection();
          if (selection.length > 0) {
            try {
              await navigator.clipboard.writeText(selection);
            } catch {
              /* ignore clipboard write errors */
            } finally {
              term.clearSelection();
            }
            return;
          }

          await pasteFromClipboard();
        })().catch((err) => {
          console.error("[ssh][paste] mouseup paste failed:", err);
        });
      };

      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        const isV = ev.key?.toLowerCase?.() === "v";
        if (!ev.ctrlKey || !isV) return true;

        // PuTTY-like paste: Ctrl+Shift+V (and Ctrl+V) reads clipboard via Rust.
        ev.preventDefault();
        ev.stopPropagation();
        void pasteFromClipboard().catch((err) => {
          console.error("[ssh][paste] key paste failed:", err);
        });
        return false;
      });

      console.debug("[panel][ssh][clipboard] handlers registered on", target.tagName);
      target.addEventListener("contextmenu", onContextMenu, { capture: true });
      target.addEventListener("mouseup", onMouseUp, { capture: true });

      clipboardHandlersRef.current = { target, onContextMenu, onMouseUp };
    } else {
      console.debug(
        "[panel][ssh][clipboard] handlers not registered (term missing?)",
      );
    }

    return () => {
      const handlers = clipboardHandlersRef.current;
      if (handlers) {
        handlers.target.removeEventListener("contextmenu", handlers.onContextMenu, {
          capture: true,
        });
        handlers.target.removeEventListener("mouseup", handlers.onMouseUp, { capture: true });
        clipboardHandlersRef.current = null;
      }
      cleanup();
    };
  }, [state]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    scheduleLayoutSync(runtime.syncSize);
  }, [layoutKey, focusMode]);

  const hostLabel = `${state.session.username}@${state.session.host}`;

  return (
    <>
      <div
        ref={panelRef}
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-vault-bg"
        aria-label={t("ssh.terminalAria")}
      >
        <SshTerminalHeader
          hostLabel={hostLabel}
          status={status}
          focusMode={focusMode}
          onToggleFocusMode={onToggleFocusMode}
          onRequestClose={() => setDisconnectConfirmOpen(true)}
        />
        <div ref={containerRef} className="min-h-0 w-full flex-1 overflow-hidden p-2" />
        <footer className="shrink-0 border-t border-vault-border bg-vault-surface px-3 py-1.5 font-mono text-[10px] text-vault-muted">
          {t("ssh.footerHint")}
        </footer>
      </div>

      <SshDisconnectConfirmationModal
        open={disconnectConfirmOpen}
        hostLabel={hostLabel}
        onClose={() => setDisconnectConfirmOpen(false)}
        onConfirm={() => {
          setDisconnectConfirmOpen(false);
          onClose();
        }}
      />
    </>
  );
}

interface SshTerminalHeaderProps {
  readonly hostLabel: string;
  readonly status: SshSessionStatus;
  readonly focusMode: boolean;
  readonly onToggleFocusMode: () => void;
  readonly onRequestClose: () => void;
}

function SshTerminalHeader({
  hostLabel,
  status,
  focusMode,
  onToggleFocusMode,
  onRequestClose,
}: Readonly<SshTerminalHeaderProps>) {
  const { t } = useTranslation();
  const focusLabel = focusMode ? t("ssh.focusModeExit") : t("ssh.focusModeEnter");

  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-vault-border bg-vault-surface px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
        <SshSessionStatusDot status={status} size="md" />
        <span className="text-vault-accent">{t("ssh.quickConnect")}</span>
        <span className="text-vault-muted">·</span>
        <span className="truncate text-vault-text">{hostLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleFocusMode}
          className="rounded border border-vault-border px-2 py-1 text-vault-muted hover:border-vault-accent hover:text-vault-accent"
          aria-label={focusLabel}
          title={focusLabel}
        >
          <span className="font-mono text-xs" aria-hidden="true">
            {focusMode ? "[ ]" : "[+]"}
          </span>
        </button>
        <button
          type="button"
          onClick={onRequestClose}
          className="rounded border border-vault-border px-3 py-1 font-mono text-[11px] text-vault-muted hover:border-vault-danger hover:text-vault-danger"
        >
          {t("common.close")}
        </button>
      </div>
    </header>
  );
}
