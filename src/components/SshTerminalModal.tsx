import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { runAsync } from "@/lib/runAsync";
import {
  getTerminalThemeFromCss,
  listenSshClosed,
  listenSshData,
  sshDisconnect,
  sshWrite,
} from "@/lib/ssh";
import type { SshTerminalState } from "@/types/ssh";
import "@xterm/xterm/css/xterm.css";

interface SshTerminalModalProps {
  readonly state: SshTerminalState;
  readonly onClose: () => void;
}

function decodeSshPayload(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.codePointAt(0) ?? 0);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    term.writeln(`\x1b[90m${i18n.t("ssh.banner")}\x1b[0m`);
    term.writeln(
      `\x1b[90m${state.session.username}@${state.session.host}  (${state.entryTitle})\x1b[0m\r\n`,
    );

    const sessionId = state.session.sessionId;
    let closed = false;

    const closeSession = (message?: string) => {
      if (closed) return;
      closed = true;
      if (message) {
        term.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
      }
      setTimeout(() => onCloseRef.current(), message ? 600 : 0);
    };

    const isSessionClosed = () => closed;

    const onDataDisposable = term.onData((data) => {
      runAsync(
        () => sshWrite(sessionId, data),
        () => closeSession(i18n.t("ssh.connectionLost")),
      );
    });

    const unlisteners: Array<() => void> = [];
    const registerListener = (register: () => Promise<() => void>) => {
      runAsync(async () => {
        const unlisten = await register();
        unlisteners.push(unlisten);
      });
    };

    registerListener(() =>
      listenSshData((event) => {
        if (event.sessionId !== sessionId || isSessionClosed()) return;
        writeSshPayload(term, event.data);
      }),
    );

    registerListener(() =>
      listenSshClosed((event) => {
        if (event.sessionId !== sessionId || isSessionClosed()) return;
        closeSession(event.error ?? i18n.t("ssh.sessionEnded"));
      }),
    );

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    const onWindowResize = () => fitAddon.fit();
    globalThis.addEventListener("resize", onWindowResize);

    term.focus();

    return () => {
      onDataDisposable.dispose();
      unlisteners.forEach((fn) => fn());
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", onWindowResize);
      runAsync(() => sshDisconnect(sessionId));
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
