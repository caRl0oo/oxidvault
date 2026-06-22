import { listen, type Event } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { isTauri } from "@/lib/ipc";
import type { VaultInfo } from "@/types/vault";

export type VaultLockedPayload = {
  reason: string;
  info: VaultInfo;
  autoLockSeconds?: number;
};

export function useVaultLockedListener(
  onVaultLocked: (payload: VaultLockedPayload) => void,
) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const handler = (event: Event<VaultLockedPayload>) => {
      onVaultLocked(event.payload);
    };

    void listen<VaultLockedPayload>("vault-locked", handler).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onVaultLocked]);
}
