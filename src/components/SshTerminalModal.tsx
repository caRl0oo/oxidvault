import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
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

    term.writeln(`\x1b[90m${i18n.t("ssh.banner")}\x1b[0m`);
    term.writeln(
      `\x1b[90m${state.session.username}@${state.session.host}  (${state.entryTitle})\x1b[0m\r\n`,
    );

    const sessionId = state.session.sessionId;

    const syncTerminalSize = () => {
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;
      if (cols > 0 && rows > 0) {
        void sshResizePty(sessionId, cols, rows).catch(() => {
          closeSession(i18n.t("ssh.connectionLost"));
        });
      }
    };

    const setup = async () => {
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
