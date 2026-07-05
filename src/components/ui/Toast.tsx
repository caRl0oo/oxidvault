// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export type ToastTone = "neutral" | "success" | "danger" | "warning";

interface ToastProps {
  readonly tone?: ToastTone;
  readonly children: ReactNode;
  /** Blendet den Status-Punkt links aus (z. B. für rein informative Toasts). */
  readonly hideDot?: boolean;
}

const TONE_BORDER: Record<ToastTone, string> = {
  neutral: "border-vault-border",
  success: "border-vault-success/40",
  danger: "border-vault-danger/40",
  warning: "border-vault-warning/40",
};

const TONE_TEXT: Record<ToastTone, string> = {
  neutral: "text-vault-text",
  success: "text-vault-success",
  danger: "text-vault-danger",
  warning: "text-vault-warning",
};

const TONE_DOT: Record<ToastTone, string> = {
  neutral: "bg-vault-muted",
  success: "bg-vault-success shadow-[0_0_5px_1px] shadow-vault-success/50",
  danger: "bg-vault-danger shadow-[0_0_5px_1px] shadow-vault-danger/50",
  warning: "bg-vault-warning shadow-[0_0_5px_1px] shadow-vault-warning/50",
};

/** Einheitlicher Toast: fixed unten zentriert, gleitet herein, Tonvarianten. */
export function Toast({ tone = "neutral", children, hideDot = false }: Readonly<ToastProps>) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`vault-toast-enter fixed bottom-12 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-md border bg-vault-elevated px-3 py-1.5 ${TONE_BORDER[tone]}`}
      style={{ boxShadow: "0 4px 16px -6px rgba(0, 0, 0, 0.5)" }}
    >
      {hideDot ? null : (
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
          aria-hidden="true"
        />
      )}
      <div className={`font-mono text-[11px] ${TONE_TEXT[tone]}`}>{children}</div>
    </div>
  );
}
