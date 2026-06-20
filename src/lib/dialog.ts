import { save, open } from "@tauri-apps/plugin-dialog";

export function normalizeVaultPath(path: string): string {
  return path.toLowerCase().endsWith(".oxid") ? path : `${path}.oxid`;
}

export async function pickVaultSavePath(defaultName = "vault.oxid"): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "OxidVault", extensions: ["oxid"] }],
  });
  return path ? normalizeVaultPath(path) : null;
}

export async function pickVaultOpenPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "OxidVault", extensions: ["oxid"] }],
  });
  return typeof path === "string" ? path : null;
}
