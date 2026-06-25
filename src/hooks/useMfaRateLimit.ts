// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LOCKOUT_SECONDS = 30;

function remainingSeconds(lockoutUntil: number): number {
  return Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
}

export function useMfaRateLimit(
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  lockoutSeconds = DEFAULT_LOCKOUT_SECONDS,
) {
  const failedAttemptsRef = useRef(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const isLockedOut = lockoutUntil !== null && secondsRemaining > 0;

  const reset = useCallback(() => {
    failedAttemptsRef.current = 0;
    setLockoutUntil(null);
    setSecondsRemaining(0);
  }, []);

  const recordInvalidMfa = useCallback(() => {
    failedAttemptsRef.current += 1;
    if (failedAttemptsRef.current >= maxAttempts) {
      const until = Date.now() + lockoutSeconds * 1000;
      setLockoutUntil(until);
      setSecondsRemaining(remainingSeconds(until));
    }
  }, [lockoutSeconds, maxAttempts]);

  useEffect(() => {
    if (lockoutUntil === null) {
      return undefined;
    }

    const tick = () => {
      const remaining = remainingSeconds(lockoutUntil);
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        reset();
      }
    };

    tick();
    const timer = globalThis.setInterval(tick, 1000);
    return () => globalThis.clearInterval(timer);
  }, [lockoutUntil, reset]);

  return {
    isLockedOut,
    secondsRemaining,
    recordInvalidMfa,
    reset,
  };
}
