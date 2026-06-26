// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { runAsync } from "@/lib/runAsync";

/** Auto-clear delay for secrets copied to the system clipboard (seconds). */
export const CLIPBOARD_CLEAR_SECONDS = 30;

export interface SecureClipboardState {
  active: boolean;
  secondsLeft: number;
}

type Listener = (state: SecureClipboardState) => void;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let lastCopied = "";
const listeners = new Set<Listener>();

function notify(state: SecureClipboardState) {
  listeners.forEach((fn) => fn(state));
}

function resetTimers() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function clearIfUnchanged() {
  const current = await readClipboard();
  if (current === null || current === lastCopied) {
    await writeClipboard("");
  }
  lastCopied = "";
  notify({ active: false, secondsLeft: 0 });
}

export function subscribeSecureClipboard(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cancel pending auto-clear (e.g. when vault is locked). */
export function cancelSecureClipboardClear(): void {
  resetTimers();
  lastCopied = "";
  notify({ active: false, secondsLeft: 0 });
}

/**
 * Copy text and schedule clipboard wipe after {@link CLIPBOARD_CLEAR_SECONDS}s.
 * Only clears if the clipboard still contains the copied value.
 */
export async function copySecureToClipboard(text: string): Promise<boolean> {
  const ok = await writeClipboard(text);
  if (!ok) return false;
  startClearTimer(text);
  return true;
}

/** Starts the auto-clear countdown after the Rust backend copied a secret. */
export function notifyBackendSecureCopy(): void {
  startClearTimer("\0backend-managed");
}

function startClearTimer(copiedValue: string): void {
  resetTimers();
  lastCopied = copiedValue;

  let secondsLeft = CLIPBOARD_CLEAR_SECONDS;
  notify({ active: true, secondsLeft });

  tickInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      resetTimers();
      notify({ active: false, secondsLeft: 0 });
    } else {
      notify({ active: true, secondsLeft });
    }
  }, 1000);

  clearTimer = setTimeout(() => {
    resetTimers();
    runAsync(() => clearIfUnchanged());
  }, CLIPBOARD_CLEAR_SECONDS * 1000);
}
