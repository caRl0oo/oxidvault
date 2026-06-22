import i18n from "@/lib/i18n";

const ERROR_PATTERNS: ReadonlyArray<{ pattern: string; key: string }> = [
  { pattern: "title is required", key: "errors.titleRequired" },
  { pattern: "fields are incomplete", key: "errors.fieldsIncomplete" },
  { pattern: "invalid master password", key: "errors.invalidMasterPassword" },
  { pattern: "invalid mfa code", key: "errors.invalidMfaCode" },
  { pattern: "vault is locked by", key: "errors.vaultLockedBy" },
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
  { pattern: "secure note content is required", key: "errors.secureNoteRequired" },
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
];

export function formatDiagnosticStatus(statusCode: string): string {
  const match = DIAGNOSTIC_STATUS_CODES.find(({ code }) => code === statusCode);
  if (match) {
    return i18n.t(match.key);
  }
  return formatVaultError(statusCode);
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
