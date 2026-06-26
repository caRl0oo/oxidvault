// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import i18n from "@/lib/i18n";
import {
  getTerminalThemeFromCss,
  listenSshClosed,
  listenSshData,
  sshBeginStreaming,
  sshResizePty,
  sshWrite,
} from "@/lib/ssh";
import type { SshDataEvent, SshTerminalState } from "@/types/ssh";

export interface TerminalRuntime {
  term: Terminal;
  fitAddon: FitAddon;
  syncSize: () => void;
}

interface SessionFlags {
  cancelled: boolean;
  closed: boolean;
}

interface TerminalSessionContext {
  term: Terminal;
  fitAddon: FitAddon;
  sessionId: string;
  state: SshTerminalState;
  flags: SessionFlags;
  endSession: (message?: string) => void;
  onSessionActive: () => void;
  syncTerminalSize: () => void;
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

export function scheduleLayoutSync(sync: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(sync);
  });
}

function awaitLayoutFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function createTerminal(container: HTMLDivElement): { term: Terminal; fitAddon: FitAddon } {
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
  return { term, fitAddon };
}

function createEndSessionHandler(
  term: Terminal,
  flags: SessionFlags,
  onSessionEnded: () => void,
): (message?: string) => void {
  return (message?: string) => {
    if (flags.closed) return;
    flags.closed = true;
    if (message) {
      term.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
    }
    globalThis.setTimeout(onSessionEnded, message ? 600 : 0);
  };
}

function createSyncTerminalSize(
  containerRef: { current: HTMLDivElement | null },
  ctx: Pick<
    TerminalSessionContext,
    "term" | "fitAddon" | "sessionId" | "flags" | "endSession"
  >,
): () => void {
  return () => {
    const target = containerRef.current;
    if (!target || ctx.flags.closed) return;

    const { width, height } = target.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    ctx.fitAddon.fit();
    const cols = ctx.term.cols;
    const rows = ctx.term.rows;
    if (cols <= 0 || rows <= 0) return;

    sshResizePty(ctx.sessionId, cols, rows).catch(onConnectionLost(ctx.endSession));
  };
}

function onConnectionLost(endSession: (message?: string) => void): () => void {
  return () => {
    endSession(i18n.t("ssh.connectionLost"));
  };
}

function handleSshDataEvent(
  event: SshDataEvent,
  sessionId: string,
  flags: SessionFlags,
  term: Terminal,
): void {
  if (event.sessionId !== sessionId || flags.closed) return;
  writeSshPayload(term, event.data);
}

function handleSshClosedEvent(
  event: { sessionId: string; error?: string },
  sessionId: string,
  flags: SessionFlags,
  endSession: (message?: string) => void,
): void {
  if (event.sessionId !== sessionId || flags.closed) return;
  endSession(event.error ?? i18n.t("ssh.sessionEnded"));
}

async function subscribeSshEvents(
  ctx: TerminalSessionContext,
): Promise<[() => void, () => void]> {
  const unlistenData = await listenSshData((event) => {
    handleSshDataEvent(event, ctx.sessionId, ctx.flags, ctx.term);
  });
  const unlistenClosed = await listenSshClosed((event) => {
    handleSshClosedEvent(event, ctx.sessionId, ctx.flags, ctx.endSession);
  });
  return [unlistenData, unlistenClosed];
}

function writeBannerAndBacklog(ctx: TerminalSessionContext, backlog: string[]): void {
  ctx.term.writeln(`\x1b[90m${i18n.t("ssh.banner")}\x1b[0m`);
  ctx.term.writeln(
    `\x1b[90m${ctx.state.session.username}@${ctx.state.session.host}  (${ctx.state.entryTitle})\x1b[0m\r\n`,
  );
  for (const chunk of backlog) {
    writeSshPayload(ctx.term, chunk);
  }
}

async function activateStreaming(ctx: TerminalSessionContext, backlog: string[]): Promise<void> {
  if (ctx.flags.cancelled || ctx.flags.closed) return;

  await awaitLayoutFrames();
  if (ctx.flags.cancelled || ctx.flags.closed) return;

  ctx.syncTerminalSize();
  writeBannerAndBacklog(ctx, backlog);

  await awaitLayoutFrames();
  if (ctx.flags.cancelled || ctx.flags.closed) return;

  ctx.syncTerminalSize();
  ctx.term.focus();
  ctx.onSessionActive();
}

function createStdinHandler(
  sessionId: string,
  endSession: (message?: string) => void,
): (data: string) => void {
  return (data: string) => {
    sshWrite(sessionId, data).catch(onConnectionLost(endSession));
  };
}

function disposeEarlyTerminal(
  term: Terminal,
  unlisteners: Array<() => void>,
  runtimeRef: { current: TerminalRuntime | null },
): void {
  for (const unlisten of unlisteners) {
    unlisten();
  }
  term.dispose();
  runtimeRef.current = null;
}

async function startTerminalStreaming(
  ctx: TerminalSessionContext,
  unlisteners: Array<() => void>,
  runtimeRef: { current: TerminalRuntime | null },
): Promise<void> {
  const [unlistenData, unlistenClosed] = await subscribeSshEvents(ctx);

  if (ctx.flags.cancelled) {
    disposeEarlyTerminal(ctx.term, [unlistenData, unlistenClosed], runtimeRef);
    return;
  }

  unlisteners.push(unlistenData, unlistenClosed);

  try {
    const backlog = await sshBeginStreaming(ctx.sessionId);
    if (ctx.flags.cancelled) return;
    ctx.syncTerminalSize();
    await activateStreaming(ctx, backlog);
  } catch {
    ctx.endSession(i18n.t("ssh.connectionLost"));
  }
}

function attachResizeObservers(
  container: HTMLDivElement,
  panel: HTMLDivElement | null,
  syncTerminalSize: () => void,
): ResizeObserver {
  const resizeObserver = new ResizeObserver(() => {
    scheduleLayoutSync(syncTerminalSize);
  });
  resizeObserver.observe(container);
  if (panel) {
    resizeObserver.observe(panel);
  }
  return resizeObserver;
}

export interface MountTerminalSessionOptions {
  readonly container: HTMLDivElement;
  readonly panel: HTMLDivElement | null;
  readonly containerRef: { current: HTMLDivElement | null };
  readonly state: SshTerminalState;
  readonly onSessionEnded: () => void;
  readonly onSessionActive: () => void;
  readonly runtimeRef: { current: TerminalRuntime | null };
}

export function mountTerminalSession(options: MountTerminalSessionOptions): () => void {
  const flags: SessionFlags = { cancelled: false, closed: false };
  const unlisteners: Array<() => void> = [];
  const { term, fitAddon } = createTerminal(options.container);
  const sessionId = options.state.session.sessionId;

  const endSession = createEndSessionHandler(term, flags, options.onSessionEnded);
  const syncTerminalSize = createSyncTerminalSize(options.containerRef, {
    term,
    fitAddon,
    sessionId,
    flags,
    endSession,
  });

  const ctx: TerminalSessionContext = {
    term,
    fitAddon,
    sessionId,
    state: options.state,
    flags,
    endSession,
    onSessionActive: options.onSessionActive,
    syncTerminalSize,
  };

  options.runtimeRef.current = { term, fitAddon, syncSize: syncTerminalSize };

  const onDataDisposable = term.onData(createStdinHandler(sessionId, endSession));
  startTerminalStreaming(ctx, unlisteners, options.runtimeRef);

  const resizeObserver = attachResizeObservers(
    options.container,
    options.panel,
    syncTerminalSize,
  );
  const onWindowResize = () => scheduleLayoutSync(syncTerminalSize);
  globalThis.addEventListener("resize", onWindowResize);
  scheduleLayoutSync(syncTerminalSize);

  return () => {
    flags.cancelled = true;
    onDataDisposable.dispose();
    for (const unlisten of unlisteners) {
      unlisten();
    }
    resizeObserver.disconnect();
    globalThis.removeEventListener("resize", onWindowResize);
    term.dispose();
    options.runtimeRef.current = null;
  };
}
