import { useEffect, useState } from "react";
import {
  subscribeSecureClipboard,
  type SecureClipboardState,
} from "@/lib/secureClipboard";

export function ClipboardToast() {
  const [state, setState] = useState<SecureClipboardState>({
    active: false,
    secondsLeft: 0,
  });

  useEffect(() => subscribeSecureClipboard(setState), []);

  if (!state.active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-10 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-vault-border bg-vault-surface px-4 py-2.5 shadow-lg"
    >
      <p className="font-mono text-xs text-vault-text">
        In Zwischenablage kopiert — wird in{" "}
        <span className="font-semibold text-vault-accent">{state.secondsLeft}s</span>{" "}
        automatisch geleert
      </p>
    </div>
  );
}
