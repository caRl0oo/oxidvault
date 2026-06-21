const THEME_SWATCH_COLORS: Record<string, [string, string]> = {
  oxid: ["#3b82f6", "#12141a"],
  dracula: ["#bd93f9", "#282a36"],
  nord: ["#88c0d0", "#2e3440"],
  matrix: ["#00ff41", "#0d0d0d"],
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
