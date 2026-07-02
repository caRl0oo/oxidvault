/**
 * Syncs the **Version:** line in ARCHITECTURE.md with src-tauri/tauri.conf.json.
 * Idempotent: running twice produces no diff when tauri.conf.json is unchanged.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
const architecturePath = join(root, "ARCHITECTURE.md");

const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const version = String(tauriConf.version ?? "").trim();
if (!version) {
  console.error("sync-architecture-version: missing version in tauri.conf.json");
  process.exit(1);
}

const architecture = readFileSync(architecturePath, "utf8");
const versionLine = `**Version:** ${version}`;
const updated = architecture.replace(
  /^\*\*Version:\*\* .+$/m,
  versionLine,
);

if (updated === architecture) {
  if (!architecture.includes(versionLine)) {
    console.error(
      "sync-architecture-version: no **Version:** line found in ARCHITECTURE.md",
    );
    process.exit(1);
  }
  process.stdout.write(`ARCHITECTURE.md already at version ${version}\n`);
} else {
  writeFileSync(architecturePath, updated, "utf8");
  process.stdout.write(`ARCHITECTURE.md version synced to ${version}\n`);
}
