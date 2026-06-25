// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useSyncExternalStore } from "react";
import {
  applyTheme,
  getStoredTheme,
  type ThemeId,
} from "@/lib/theme";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("oxidvault-theme-change", onStoreChange);
  return () => window.removeEventListener("oxidvault-theme-change", onStoreChange);
}

function getSnapshot(): ThemeId {
  return getStoredTheme();
}

function getServerSnapshot(): ThemeId {
  return "oxid";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: ThemeId) => {
    applyTheme(next);
    window.dispatchEvent(new Event("oxidvault-theme-change"));
  }, []);

  return { theme, setTheme };
}
