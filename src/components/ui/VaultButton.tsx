// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { type ButtonHTMLAttributes } from "react";
import {
  BTN_GHOST_CLASS,
  BTN_OUTLINE_CLASS,
  BTN_OUTLINE_DANGER_CLASS,
  BTN_PRIMARY_CLASS,
} from "@/lib/uiClasses";

export type VaultButtonVariant = "primary" | "outline" | "ghost";
export type VaultButtonTone = "default" | "danger";

interface VaultButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: VaultButtonVariant;
  readonly tone?: VaultButtonTone;
  readonly fullWidth?: boolean;
  readonly size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: "px-2 py-1.5 text-[10px]",
  md: "px-3 py-1.5 text-xs",
} as const;

function resolveVariantClass(variant: VaultButtonVariant, tone: VaultButtonTone): string {
  if (variant === "primary") {
    return BTN_PRIMARY_CLASS;
  }
  if (variant === "ghost") {
    return BTN_GHOST_CLASS;
  }
  return tone === "danger" ? BTN_OUTLINE_DANGER_CLASS : BTN_OUTLINE_CLASS;
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
