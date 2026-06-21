import { invoke } from "@tauri-apps/api/core";
import type { SecurityAuditReport } from "@/types/audit";
import type { AuditLogEntry } from "@/types/auditLog";
import type { ResolvedConfig } from "@/types/policy";
import type { AppSettings, GitSyncResult } from "@/types/settings";
import type {
  PasswordGenOptions,
  RevealedSecret,
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
  SecretField,
  VaultInfo,
} from "@/types/vault";

export async function healthCheck(): Promise<string> {
  return invoke<string>("health_check");
}

export async function getVaultInfo(): Promise<VaultInfo> {
  return invoke<VaultInfo>("get_vault_info");
}

export async function bootstrapVault(): Promise<VaultInfo> {
  return invoke<VaultInfo>("bootstrap_vault");
}

export async function detachVault(): Promise<void> {
  return invoke<void>("detach_vault");
}

export async function createVault(
  path: string,
  name: string,
  password: string,
): Promise<VaultInfo> {
  return invoke<VaultInfo>("create_vault", { path, name, password });
}

export async function openVault(
  path: string,
  password: string,
): Promise<VaultInfo> {
  return invoke<VaultInfo>("open_vault", { path, password });
}

export async function unlockVault(password: string): Promise<VaultInfo> {
  return invoke<VaultInfo>("unlock_vault", { password });
}

export async function lockVault(): Promise<VaultInfo> {
  return invoke<VaultInfo>("lock_vault");
}

export async function listEntries(): Promise<SecretEntrySummary[]> {
  return invoke<SecretEntrySummary[]>("list_entries");
}

export async function addEntry(
  input: SecretEntryInputFull,
): Promise<SecretEntrySummary> {
  return invoke<SecretEntrySummary>("add_entry", { input });
}

export async function updateEntry(
  id: string,
  input: SecretEntryInputFull,
): Promise<SecretEntrySummary> {
  return invoke<SecretEntrySummary>("update_entry", { id, input });
}

export async function getEntry(id: string): Promise<SecretEntryPublic> {
  return invoke<SecretEntryPublic>("get_entry", { id });
}

export async function revealSecret(
  entryId: string,
  field: SecretField = "primary",
): Promise<RevealedSecret> {
  return invoke<RevealedSecret>("reveal_secret", { entryId, field });
}

export async function copyToClipboard(
  entryId: string,
  field: SecretField = "primary",
): Promise<void> {
  return invoke<void>("copy_to_clipboard", { entryId, field });
}

export async function generatePassword(options: PasswordGenOptions): Promise<string> {
  return invoke<string>("generate_password_cmd", { options });
}

export async function checkEntriesReachability(
  entryIds: string[],
): Promise<
  Array<{
    entryId: string;
    status: string;
    host?: string;
    port?: number;
    error?: string;
  }>
> {
  return invoke("check_entries_reachability", { entryIds });
}

export async function auditVaultSecurity(): Promise<SecurityAuditReport> {
  return invoke<SecurityAuditReport>("audit_vault_security");
}

export async function getAuditLogs(limit: number): Promise<AuditLogEntry[]> {
  return invoke<AuditLogEntry[]>("get_audit_logs", { limit });
}

export async function exportAuditLog(
  targetPath: string,
  format: "json" | "csv",
): Promise<void> {
  return invoke<void>("export_audit_log", { targetPath, format });
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function getResolvedConfig(): Promise<ResolvedConfig> {
  return invoke<ResolvedConfig>("get_resolved_config");
}

export async function updateGitSyncSettings(
  enabled: boolean,
  remoteUrl: string | null,
): Promise<AppSettings> {
  return invoke<AppSettings>("update_git_sync_settings", { enabled, remoteUrl });
}

export async function syncVaultGit(): Promise<GitSyncResult> {
  return invoke<GitSyncResult>("sync_vault_git");
}

export function isTauri(): boolean {
  return typeof globalThis  !== "undefined" && "__TAURI_INTERNALS__" in globalThis ;
}
