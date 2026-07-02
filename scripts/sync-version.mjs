/**
 * Syncs documented app version from src-tauri/tauri.conf.json into:
 * - ARCHITECTURE.md (**Version:** line)
 * - README.md (version badge + latest MSI filename only; not changelog/history)
 *
 * Idempotent: running twice produces no diff when tauri.conf.json is unchanged.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
const architecturePath = join(root, "ARCHITECTURE.md");
const readmePath = join(root, "README.md");

const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const version = String(tauriConf.version ?? "").trim();
if (!version) {
  console.error("sync-version: missing version in tauri.conf.json");
  process.exit(1);
}

let changed = false;

function syncFile(path, label, transform) {
  const original = readFileSync(path, "utf8");
  const { content, touched } = transform(original);
  if (content === original) {
    return;
  }
  writeFileSync(path, content, "utf8");
  changed = true;
  process.stdout.write(`${label} version synced to ${version}\n`);
}

syncFile(architecturePath, "ARCHITECTURE.md", (architecture) => {
  const versionLine = `**Version:** ${version}`;
  const updated = architecture.replace(
    /^\*\*Version:\*\* .+$/m,
    versionLine,
  );
  if (updated === architecture && !architecture.includes(versionLine)) {
    console.error("sync-version: no **Version:** line found in ARCHITECTURE.md");
    process.exit(1);
  }
  return { content: updated, touched: updated !== architecture };
});

syncFile(readmePath, "README.md", (readme) => {
  const patterns = [
    {
      name: "shields.io Version badge",
      re: /(img\.shields\.io\/badge\/Version-)\d+\.\d+\.\d+(-blue)/g,
      replace: `$1${version}$2`,
    },
    {
      name: "Windows MSI download filename",
      re: /(OxidVault_)\d+\.\d+\.\d+(_x64_en-US\.msi)/g,
      replace: `$1${version}$2`,
    },
  ];

  let updated = readme;
  for (const { name, re, replace } of patterns) {
    if (!re.test(readme)) {
      console.error(`sync-version: pattern not found in README.md (${name})`);
      process.exit(1);
    }
    re.lastIndex = 0;
    updated = updated.replace(re, replace);
  }

  return { content: updated, touched: updated !== readme };
});

if (!changed) {
  process.stdout.write(`Docs already at version ${version}\n`);
}
