// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri, touchActivity } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";

const UI_ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "wheel",
  "touchstart",
] as const;

/**
 * Registers UI activity with the backend idle watcher and surfaces pre-lock warnings.
 */
export function useAutoLock(
  enabled: boolean,
  onIdleWarning: (secondsRemaining: number) => void,
  onActivity?: () => void,
) {
  useEffect(() => {
    if (!enabled || !isTauri()) {
      return;
    }

    let unlistenWarning: (() => void) | undefined;

    const pingActivity = () => {
      onActivity?.();
      runAsync(touchActivity);
    };

    for (const event of UI_ACTIVITY_EVENTS) {
      globalThis.addEventListener(event, pingActivity, { passive: true });
    }

    runAsync(async () => {
      unlistenWarning = await listen<{ secondsRemaining: number }>(
        "vault-idle-warning",
        (event) => {
          onIdleWarning(event.payload.secondsRemaining);
        },
      );
    });

    return () => {
      unlistenWarning?.();
      for (const event of UI_ACTIVITY_EVENTS) {
        globalThis.removeEventListener(event, pingActivity);
      }
    };
  }, [enabled, onIdleWarning, onActivity]);
}
