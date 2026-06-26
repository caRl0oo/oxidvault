// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/ipc";

export function useExtensionPrefillListener(onPrefill: () => void) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen("extension-new-secret-prefill", onPrefill).then((fn) => {
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
  }, [onPrefill]);
}
