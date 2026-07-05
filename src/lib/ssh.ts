// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SshClosedEvent, SshConnectResponse, SshDataEvent, SshSessionInfo } from "@/types/ssh";

export async function sshConnect(
  entryId: string,
  cols: number,
  rows: number,
): Promise<SshConnectResponse> {
  return invoke<SshConnectResponse>("ssh_connect", { entryId, cols, rows });
}

export async function sshTrustHost(
  entryId: string,
  sessionId: string,
  fingerprint: string,
): Promise<SshSessionInfo> {
  return invoke<SshSessionInfo>("ssh_trust_host", { entryId, sessionId, fingerprint });
}

export async function sshRejectHost(sessionId: string): Promise<void> {
  return invoke("ssh_reject_host", { sessionId });
}

export async function clearSshHostFingerprint(entryId: string): Promise<void> {
  return invoke("ssh_clear_host_fingerprint", { entryId });
}

/** Enables live ssh-data events and returns output emitted before the UI attached. */
export async function sshBeginStreaming(sessionId: string): Promise<string[]> {
  return invoke<string[]>("ssh_begin_streaming", { sessionId });
}

export async function sshWrite(sessionId: string, data: string): Promise<void> {
  return invoke("ssh_write", { sessionId, data });
}

export async function sshResizePty(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("ssh_resize_pty", { sessionId, cols, rows });
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  return invoke("ssh_disconnect", { sessionId });
}

export function listenSshData(handler: (event: SshDataEvent) => void): Promise<UnlistenFn> {
  return listen<SshDataEvent>("ssh-data", (e) => handler(e.payload));
}

export function listenSshClosed(handler: (event: SshClosedEvent) => void): Promise<UnlistenFn> {
  return listen<SshClosedEvent>("ssh-closed", (e) => handler(e.payload));
}

/** Reads vault theme CSS variables for xterm.js theming. */
export function getTerminalThemeFromCss(): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
} {
  const root = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;

  return {
    background: pick("--color-vault-bg", "#05070d"),
    foreground: pick("--color-vault-text", "#dde3ed"),
    cursor: pick("--color-vault-accent", "#00b8a0"),
    selectionBackground: pick("--color-vault-accent", "#00b8a0") + "44",
  };
}
