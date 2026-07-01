// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@/lib/ipc";
import { runAsync } from "@/lib/runAsync";

/** App version label from `tauri.conf.json` (e.g. `v2.3.0`), or `null` while loading. */
export function useAppVersionLabel(enabled = true): string | null {
  const [versionLabel, setVersionLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVersionLabel(null);
      return;
    }
    if (!isTauri()) {
      return;
    }

    let cancelled = false;
    runAsync(async () => {
      const version = await getVersion();
      if (!cancelled) {
        setVersionLabel(`v${version}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return versionLabel;
}
