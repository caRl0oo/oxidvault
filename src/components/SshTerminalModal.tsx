// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { readClipboardText } from "@/lib/ipc";
import {
  getTerminalThemeFromCss,
  listenSshClosed,
  listenSshData,
  sshBeginStreaming,
  sshResizePty,
  sshWrite,
} from "@/lib/ssh";
import type { SshTerminalState } from "@/types/ssh";
import "@xterm/xterm/css/xterm.css";

interface SshTerminalModalProps {
  readonly state: SshTerminalState;
  readonly onClose: () => void;
}

function decodeSshPayload(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}

function writeSshPayload(term: Terminal, data: string): void {
  try {
    term.write(decodeSshPayload(data));
  } catch {
    /* ignore malformed payload */
  }
}

export function SshTerminalModal({ state, onClose }: Readonly<SshTerminalModalProps>) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const DEBUG_CLIPBOARD = import.meta.env.DEV;
  const sessionIdRef = useRef(state.session.sessionId);
  const clipboardHandlersRef = useRef<{
    target: HTMLElement;
    onContextMenu: (event: MouseEvent) => void;
    onMouseUp: (event: MouseEvent) => void;
  } | null>(null);

  useEffect(() => {
    sessionIdRef.current = state.session.sessionId;
  }, [state.session.sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let closed = false;
    const unlisteners: Array<() => void> = [];

    const closeSession = (message?: string) => {
      if (closed) return;
      closed = true;
      if (message) {
        term.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
      }
      setTimeout(() => onCloseRef.current(), message ? 600 : 0);
    };

    const theme = getTerminalThemeFromCss();
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

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
        console.debug(
          "[ssh][paste] sessionId present:",
          Boolean(currentSessionId),
          "len:",
          text.length,
        );
      }

      if (!text) return;
      try {
        await sshWrite(currentSessionId, text);
      } catch (err) {
        console.error("[ssh][paste] ssh_write failed:", err);
      }
    };

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
        if (cancelled || closed) return;

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

    const termElement = (term as unknown as { element?: HTMLElement }).element;
    const target = termElement ?? container;

    console.debug("[modal][ssh][clipboard] handlers registered on", target.tagName);
    target.addEventListener("contextmenu", onContextMenu, { capture: true });
    target.addEventListener("mouseup", onMouseUp, { capture: true });
    clipboardHandlersRef.current = { target, onContextMenu, onMouseUp };

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const isV = ev.key?.toLowerCase?.() === "v";
      if (!ev.ctrlKey || !isV) return true;

      // Replace native paste path for PuTTY-like shortcuts.
      ev.preventDefault();
      ev.stopPropagation();

      void pasteFromClipboard().catch((err) => {
        console.error("[ssh][paste] key paste failed:", err);
      });
      return false;
    });

    term.writeln(`\x1b[90m${i18n.t("ssh.banner")}\x1b[0m`);
    term.writeln(
      `\x1b[90m${state.session.username}@${state.session.host}  (${state.entryTitle})\x1b[0m\r\n`,
    );

    const syncTerminalSize = () => {
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;
      if (cols > 0 && rows > 0) {
        void sshResizePty(sessionIdRef.current, cols, rows).catch(() => {
          closeSession(i18n.t("ssh.connectionLost"));
        });
      }
    };

    const setup = async () => {
      const sessionId = sessionIdRef.current;
      const unlistenData = await listenSshData((event) => {
        if (event.sessionId !== sessionId || closed) return;
        writeSshPayload(term, event.data);
      });
      const unlistenClosed = await listenSshClosed((event) => {
        if (event.sessionId !== sessionId || closed) return;
        closeSession(event.error ?? i18n.t("ssh.sessionEnded"));
      });

      if (cancelled) {
        unlistenData();
        unlistenClosed();
        term.dispose();
        return;
      }

      unlisteners.push(unlistenData, unlistenClosed);

      try {
        const backlog = await sshBeginStreaming(sessionId);
        if (cancelled) return;
        for (const chunk of backlog) {
          writeSshPayload(term, chunk);
        }
        syncTerminalSize();
        term.focus();
      } catch {
        closeSession(i18n.t("ssh.connectionLost"));
      }
    };

    const onDataDisposable = term.onData((data) => {
      const sessionId = sessionIdRef.current;
      void sshWrite(sessionId, data).catch(() => {
        closeSession(i18n.t("ssh.connectionLost"));
      });
    });

    void setup();

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalSize();
    });
    resizeObserver.observe(container);

    const onWindowResize = () => syncTerminalSize();
    globalThis.addEventListener("resize", onWindowResize);

    return () => {
      cancelled = true;
      onDataDisposable.dispose();
      unlisteners.forEach((fn) => fn());
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", onWindowResize);
      const handlers = clipboardHandlersRef.current;
      if (handlers) {
        handlers.target.removeEventListener("contextmenu", handlers.onContextMenu, {
          capture: true,
        });
        handlers.target.removeEventListener("mouseup", handlers.onMouseUp, { capture: true });
        clipboardHandlersRef.current = null;
      }
      term.dispose();
    };
  }, [state]);

  return (
    <dialog
      open
      className="fixed inset-0 z-[70] m-0 flex max-h-none max-w-none flex-col border-0 bg-vault-bg/95 p-0 backdrop-blur-sm"
      aria-label={t("ssh.terminalAria")}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-vault-border bg-vault-surface px-4 py-2">
        <div className="min-w-0 font-mono text-xs">
          <span className="text-vault-accent">{t("ssh.quickConnect")}</span>
          <span className="mx-2 text-vault-muted">·</span>
          <span className="text-vault-text">
            {state.session.username}@{state.session.host}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-vault-border px-3 py-1 font-mono text-[11px] text-vault-muted hover:border-vault-danger hover:text-vault-danger"
        >
          {t("common.close")}
        </button>
      </header>
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
      <footer className="shrink-0 border-t border-vault-border bg-vault-surface px-4 py-1.5 font-mono text-[10px] text-vault-muted">
        {t("ssh.footerHint")}
      </footer>
    </dialog>
  );
}
