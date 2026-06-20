import { useEffect } from "react";

/** Default inactivity timeout before auto-lock (seconds). */
export const AUTO_LOCK_SECONDS = 120;

/**
 * Tracks user activity (mouse, keyboard, scroll) and calls `onLock`
 * after `timeoutSeconds` of total inactivity.
 */
export function useAutoLock(
  enabled: boolean,
  onLock: () => void,
  timeoutSeconds = AUTO_LOCK_SECONDS,
) {
  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onLock, timeoutSeconds * 1000);
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "wheel",
      "touchstart",
    ] as const;

    for (const event of events) {
      window.addEventListener(event, reset, { passive: true });
    }
    reset();

    return () => {
      if (timer) clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, reset);
      }
    };
  }, [enabled, onLock, timeoutSeconds]);
}
