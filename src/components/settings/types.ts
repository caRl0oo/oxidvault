export type SettingsCategory = "general" | "sync" | "security";

export function requiresUnlockedVault(category: SettingsCategory): boolean {
  return category === "sync" || category === "security";
}
