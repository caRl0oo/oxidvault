// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type ShortcutMap = Record<string, () => void>;

interface KeyboardShortcutOptions {
  readonly quitOnModQ?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutMap,
  enabled = true,
  options?: KeyboardShortcutOptions,
) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (
        options?.quitOnModQ &&
        event.key.toLowerCase() === "q" &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        void invoke("quit_app");
        return;
      }

      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push("mod");
      if (event.shiftKey) parts.push("shift");
      if (event.altKey) parts.push("alt");

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      parts.push(key);

      const combo = parts.join("+");
      const action = shortcuts[combo];
      if (action) {
        event.preventDefault();
        action();
      }
    };

    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [shortcuts, enabled, options?.quitOnModQ]);
}
