// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toast } from "@/components/ui/Toast";
import {
  subscribeSecureClipboard,
  type SecureClipboardState,
} from "@/lib/secureClipboard";

export function ClipboardToast() {
  const { t } = useTranslation();
  const [state, setState] = useState<SecureClipboardState>({
    active: false,
    secondsLeft: 0,
  });

  useEffect(() => subscribeSecureClipboard(setState), []);

  if (!state.active) return null;

  return <Toast tone="neutral">{t("copy.clipboardToast", { seconds: state.secondsLeft })}</Toast>;
}
