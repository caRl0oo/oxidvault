// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

const THEME_SWATCH_COLORS: Record<string, [string, string]> = {
  oxid: ["#00b8a0", "#0e1422"],
  "oxid-light": ["#00a896", "#ffffff"],
  dracula: ["#bd93f9", "#282a36"],
  nord: ["#88c0d0", "#2e3440"],
};

export function ThemeSwatch({ themeId }: Readonly<{ themeId: string }>) {
  const [accent, bg] = THEME_SWATCH_COLORS[themeId] ?? THEME_SWATCH_COLORS.oxid;
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-vault-border"
      style={{ background: `linear-gradient(135deg, ${accent} 50%, ${bg} 50%)` }}
      aria-hidden
    />
  );
}
