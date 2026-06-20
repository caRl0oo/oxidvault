import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SshClosedEvent, SshDataEvent, SshSessionInfo } from "@/types/ssh";

export async function sshConnect(entryId: string): Promise<SshSessionInfo> {
  return invoke<SshSessionInfo>("ssh_connect", { entryId });
}

export async function sshWrite(sessionId: string, data: string): Promise<void> {
  return invoke("ssh_write", { sessionId, data });
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
    background: pick("--color-vault-bg", "#0a0b0d"),
    foreground: pick("--color-vault-text", "#e5e7eb"),
    cursor: pick("--color-vault-accent", "#3b82f6"),
    selectionBackground: pick("--color-vault-accent", "#3b82f6") + "44",
  };
}
