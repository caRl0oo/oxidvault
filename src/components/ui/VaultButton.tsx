// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { type ButtonHTMLAttributes } from "react";
import { UI } from "@/lib/uiClasses";

export type VaultButtonVariant = "primary" | "outline" | "ghost";
export type VaultButtonTone = "default" | "danger";

interface VaultButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: VaultButtonVariant;
  readonly tone?: VaultButtonTone;
  readonly fullWidth?: boolean;
  readonly size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
} as const;

function resolveVariantClass(variant: VaultButtonVariant, tone: VaultButtonTone): string {
  if (variant === "primary") {
    return UI.btnPrimary;
  }
  if (variant === "ghost") {
    return UI.btnGhost;
  }
  return tone === "danger" ? UI.btnDanger : UI.btnSecondary;
}

/** Theme-aware button — colors follow active `[data-theme]` CSS variables. */
export function VaultButton({
  variant = "primary",
  tone = "default",
  fullWidth = false,
  size = "md",
  className = "",
  type = "button",
  ...props
}: Readonly<VaultButtonProps>) {
  const widthClass = fullWidth ? "w-full" : "";
  const variantClass = resolveVariantClass(variant, tone);

  return (
    <button
      type={type}
      className={`${variantClass} ${SIZE_CLASS[size]} ${widthClass} ${className}`.trim()}
      {...props}
    />
  );
}
