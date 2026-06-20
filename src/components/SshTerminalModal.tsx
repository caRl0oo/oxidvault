import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
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
  state: SshTerminalState;
  onClose: () => void;
}

export function SshTerminalModal({ state, onClose }: SshTerminalModalProps) {
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

    term.writeln(`\x1b[90m── OxidVault SSH Quick Connect ──\x1b[0m`);
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

    const onDataDisposable = term.onData((data) => {
      void sshWrite(sessionId, data).catch(() => {
        closeSession("Verbindung unterbrochen.");
      });
    });

    const unlisteners: Array<() => void> = [];
    void listenSshData((event) => {
      if (event.sessionId !== sessionId || closed) return;
      try {
        const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
        term.write(bytes);
      } catch {
        /* ignore malformed payload */
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    void listenSshClosed((event) => {
      if (event.sessionId !== sessionId || closed) return;
      closeSession(event.error ?? "Sitzung beendet.");
    }).then((unlisten) => unlisteners.push(unlisten));

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    const onWindowResize = () => fitAddon.fit();
    window.addEventListener("resize", onWindowResize);

    term.focus();

    return () => {
      onDataDisposable.dispose();
      unlisteners.forEach((fn) => fn());
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      void sshDisconnect(sessionId);
      term.dispose();
    };
  }, [state]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-vault-bg/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="SSH Terminal"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-vault-border bg-vault-surface px-4 py-2">
        <div className="min-w-0 font-mono text-xs">
          <span className="text-vault-accent">Quick Connect</span>
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
          Schließen
        </button>
      </header>
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
      <footer className="shrink-0 border-t border-vault-border bg-vault-surface px-4 py-1.5 font-mono text-[10px] text-vault-muted">
        Private Key verbleibt im Rust-Speicher — wird nicht in die Zwischenablage kopiert.
      </footer>
    </div>
  );
}
