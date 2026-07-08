// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

interface AppLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const SIZE_CLASS = {
  sm: "h-6 w-6",
  md: "h-9 w-9",
  lg: "h-14 w-14",
} as const;

export function AppLogo({ size = "md", className = "" }: Readonly<AppLogoProps>) {
  return (
    <img
      src="/logo.svg"
      alt=""
      aria-hidden
      className={`${SIZE_CLASS[size]} shrink-0 object-contain ${className}`.trim()}
    />
  );
}
