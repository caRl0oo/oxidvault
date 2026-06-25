// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import type { SecurityAuditReport } from "@/types/audit";
import type { AuditLogEntry } from "@/types/auditLog";
import type { ComplianceStatus } from "@/types/compliance";
import type { SystemDiagnostics } from "@/types/diagnostics";
import type { ResolvedConfig } from "@/types/policy";
import type { AppSettings, GitSyncResult } from "@/types/settings";
import type { MfaSetupInfo, MfaStatus } from "@/types/mfa";
import type {
  PasswordGenOptions,
  RevealedSecret,
  SecretEntryInputFull,
  SecretEntryPublic,
  SecretEntrySummary,
  SecretField,
  UnlockVaultResponse,
  UserRole,
  VaultInfo,
  VaultUserPublic,
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
  mfaCode?: string,
): Promise<UnlockVaultResponse> {
  return invoke<UnlockVaultResponse>("open_vault", {
    path,
    password,
    mfaCode: mfaCode ?? null,
  });
}

export async function unlockVault(
  password: string,
  mfaCode?: string,
): Promise<UnlockVaultResponse> {
  return invoke<UnlockVaultResponse>("unlock_vault", {
    password,
    mfaCode: mfaCode ?? null,
  });
}

export async function lockVault(): Promise<VaultInfo> {
  return invoke<VaultInfo>("lock_vault");
}

export async function touchActivity(): Promise<void> {
  return invoke<void>("touch_activity");
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

export async function deleteEntry(id: string): Promise<void> {
  return invoke<void>("delete_entry", { id });
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

/** One-shot password prefill from the browser extension (consumed on read). */
export async function takeExtensionNewSecret(): Promise<string | null> {
  return invoke<string | null>("take_extension_new_secret");
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

export async function getComplianceStatus(): Promise<ComplianceStatus> {
  return invoke<ComplianceStatus>("get_compliance_status");
}

export async function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  return invoke<SystemDiagnostics>("get_system_diagnostics");
}

export async function reencryptVault(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke<void>("reencrypt_vault", { currentPassword, newPassword });
}

export async function updateGitSyncSettings(
  enabled: boolean,
  remoteUrl: string | null,
  sshKeyPath?: string | null,
): Promise<AppSettings> {
  return invoke<AppSettings>("update_git_sync_settings", {
    enabled,
    remoteUrl,
    sshKeyPath: sshKeyPath?.trim() || null,
  });
}

export async function triggerGitSync(): Promise<GitSyncResult> {
  return invoke<GitSyncResult>("trigger_git_sync");
}

/** Stores the Git SSH key passphrase in the OS credential store (never in settings.json). */
export async function saveSshPassphrase(passphrase: string): Promise<void> {
  try {
    await invoke<void>("save_ssh_passphrase", { passphrase });
  } catch (error) {
    console.error("[git-sync] save_ssh_passphrase failed:", error);
    throw error;
  }
}

/** Removes the Git SSH key passphrase from the OS credential store. */
export async function removeSshPassphrase(): Promise<void> {
  try {
    await invoke<void>("remove_ssh_passphrase");
  } catch (error) {
    console.error("[git-sync] remove_ssh_passphrase failed:", error);
    throw error;
  }
}

/** @deprecated Use `triggerGitSync` — kept for existing call sites. */
export async function syncVaultGit(): Promise<GitSyncResult> {
  return triggerGitSync();
}

export async function enableMFA(): Promise<MfaSetupInfo> {
  return invoke<MfaSetupInfo>("enable_mfa");
}

export async function getMfaStatus(): Promise<MfaStatus> {
  return invoke<MfaStatus>("get_mfa_status");
}

export async function disableMFA(): Promise<void> {
  return invoke<void>("disable_mfa");
}

export async function verifyMFACode(code: string): Promise<boolean> {
  return invoke<boolean>("verify_mfa_code", { code });
}

export async function attachVaultPath(path: string): Promise<VaultInfo> {
  return invoke<VaultInfo>("attach_vault_path", { path });
}

export async function createVaultV3(
  path: string,
  vaultName: string,
  adminUsername: string,
  adminPassword: string,
): Promise<VaultInfo> {
  return invoke<VaultInfo>("create_vault_v3", {
    path,
    vaultName,
    adminUsername,
    adminPassword,
  });
}

export async function unlockVaultAsUser(
  username: string,
  password: string,
  mfaCode?: string,
): Promise<UnlockVaultResponse> {
  return invoke<UnlockVaultResponse>("unlock_vault_as_user", {
    username,
    password,
    mfaCode: mfaCode ?? null,
  });
}

export async function listVaultUsers(): Promise<VaultUserPublic[]> {
  return invoke<VaultUserPublic[]>("list_vault_users");
}

export async function addVaultUser(
  newUsername: string,
  newPassword: string,
  role: UserRole,
): Promise<VaultUserPublic> {
  return invoke<VaultUserPublic>("add_vault_user", { newUsername, newPassword, role });
}

export async function removeVaultUser(username: string): Promise<void> {
  return invoke<void>("remove_vault_user", { username });
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke<void>("change_user_password", { currentPassword, newPassword });
}

export async function migrateVaultToV3(
  currentPassword: string,
  adminUsername: string,
): Promise<VaultInfo> {
  return invoke<VaultInfo>("migrate_vault_to_v3", { currentPassword, adminUsername });
}

export async function getCurrentUser(): Promise<VaultUserPublic | null> {
  return invoke<VaultUserPublic | null>("get_current_user");
}

export function isTauri(): boolean {
  return typeof globalThis  !== "undefined" && "__TAURI_INTERNALS__" in globalThis ;
}
