// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "@/lib/i18n";

const ERROR_PATTERNS: ReadonlyArray<{ pattern: string; key: string }> = [
  { pattern: "title is required", key: "errors.titleRequired" },
  { pattern: "fields are incomplete", key: "errors.fieldsIncomplete" },
  { pattern: "invalid master password", key: "errors.invalidMasterPassword" },
  { pattern: "invalid mfa code", key: "errors.invalidMfaCode" },
  { pattern: "vault is locked by", key: "errors.vaultLockedBy" },
  { pattern: "weak master password: too_short", key: "errors.weakPasswordTooShort" },
  { pattern: "weak master password: blocklisted", key: "errors.weakPasswordBlocklisted" },
  { pattern: "weak master password: low_entropy", key: "errors.weakPasswordLowEntropy" },
  { pattern: "weak master password", key: "errors.weakMasterPassword" },
  { pattern: "too common", key: "errors.tooCommon" },
  { pattern: "at least 12 characters", key: "errors.atLeast12Chars" },
  { pattern: "vault file already exists", key: "errors.vaultFileExists" },
  { pattern: "invalid vault file", key: "errors.invalidVaultFile" },
  { pattern: "vault not initialized", key: "errors.vaultNotInitialized" },
  { pattern: "no vault file loaded", key: "errors.noVaultFileLoaded" },
  { pattern: "audit log corrupted", key: "errors.auditLogCorrupted" },
  { pattern: "url ist leer", key: "errors.urlEmpty" },
  { pattern: "url ist ungültig", key: "errors.urlInvalid" },
  { pattern: "url muss mit http:// oder https:// beginnen", key: "errors.urlMustHttp" },
  { pattern: "url enthält ungültige zeichen", key: "errors.urlInvalidChars" },
  { pattern: "url darf keine leerzeichen enthalten", key: "errors.urlNoSpaces" },
  { pattern: "database fields are incomplete", key: "errors.databaseIncomplete" },
  { pattern: "network wifi fields are incomplete", key: "errors.wifiIncomplete" },
  { pattern: "invalid password for user", key: "errors.invalidUserPassword" },
  { pattern: "username already exists", key: "errors.userAlreadyExists" },
  { pattern: "user not found", key: "errors.userNotFound" },
  { pattern: "insufficient permissions", key: "errors.insufficientPermissions" },
  { pattern: "cannot remove the last admin", key: "errors.lastAdminCannotBeRemoved" },
  { pattern: "invalid username", key: "errors.invalidUsername" },
];

const DIAGNOSTIC_STATUS_CODES: ReadonlyArray<{ code: string; key: string }> = [
  { code: "ok", key: "diagnostics.statusCodes.ok" },
  { code: "vault_not_loaded", key: "diagnostics.statusCodes.vault_not_loaded" },
  { code: "vault_file_not_found", key: "diagnostics.statusCodes.vault_file_not_found" },
  { code: "vault_path_not_reachable", key: "diagnostics.statusCodes.vault_path_not_reachable" },
  { code: "vault_dir_not_writable", key: "diagnostics.statusCodes.vault_dir_not_writable" },
  { code: "policy_not_configured", key: "diagnostics.statusCodes.policy_not_configured" },
  { code: "policy_invalid", key: "diagnostics.statusCodes.policy_invalid" },
  { code: "policy_not_readable", key: "diagnostics.statusCodes.policy_not_readable" },
  { code: "audit_no_vault", key: "diagnostics.statusCodes.audit_no_vault" },
  { code: "audit_not_writable", key: "diagnostics.statusCodes.audit_not_writable" },
  { code: "audit_chain_invalid", key: "diagnostics.statusCodes.audit_chain_invalid" },
  { code: "audit_not_present", key: "diagnostics.statusCodes.audit_not_present" },
  { code: "audit_no_checkpoints", key: "diagnostics.statusCodes.audit_no_checkpoints" },
];

export function formatDiagnosticStatus(statusCode: string): string {
  const match = DIAGNOSTIC_STATUS_CODES.find(({ code }) => code === statusCode);
  if (match) {
    return i18n.t(match.key);
  }
  return formatVaultError(statusCode);
}

export function isLicenseLimitError(error: unknown): boolean {
  return String(error).includes("license_limit_exceeded");
}

export function formatVaultError(error: unknown): string {
  const raw = String(error).replace(/^Error:\s*/i, "").trim();
  const lower = raw.toLowerCase();
  for (const { pattern, key } of ERROR_PATTERNS) {
    if (lower.includes(pattern)) {
      return i18n.t(key);
    }
  }
  return raw || i18n.t("errors.unknown");
}

export function isInvalidMfaError(error: unknown): boolean {
  const lower = String(error).replace(/^Error:\s*/i, "").trim().toLowerCase();
  return lower.includes("invalid mfa code");
}

const MULTI_USER_AUTH_FAILURE_PATTERNS = [
  "user not found",
  "invalid password for user",
  "invalid master password",
] as const;

/** Maps v3 login failures to a generic message — never reveals whether the username exists. */
export function formatMultiUserAuthError(error: unknown): string {
  if (isInvalidMfaError(error)) {
    return formatVaultError(error);
  }
  const lower = String(error).replace(/^Error:\s*/i, "").trim().toLowerCase();
  if (MULTI_USER_AUTH_FAILURE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return i18n.t("auth.invalidCredentials");
  }
  return formatVaultError(error);
}
