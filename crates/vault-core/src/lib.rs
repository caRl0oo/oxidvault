// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

pub mod audit;
pub mod audit_export;
mod audit_secure;
pub mod auth;
pub mod compliance;
pub mod crypto;
pub mod diagnostics;
pub mod entry;
pub mod error;
pub mod expiry;
pub mod format;
pub mod generator;
pub mod license;
pub mod lock;
pub mod mfa;
pub mod path_util;
pub mod policy;
pub mod probe;
pub mod security_audit;
pub mod unlock;
pub mod url_match;
pub mod vault;
pub mod vault_user;

pub use audit::{
    audit_log_has_checkpoints, derive_audit_hmac_key, init as init_audit_log, log_event_for_vault,
    read_audit_logs, verify_audit_chain, verify_audit_chain_keyed, AuditAction, AuditLog,
    AuditLogEntry, AuditLogger, AUDIT_CHECKPOINT_INTERVAL, AUDIT_NO_CHECKPOINTS,
};
pub use audit_export::{export_audit_report, ExportFormat};
pub use auth::{unlock_vault as authenticate_unlock, AuthError, VaultHandle};
pub use compliance::{compliance_status, ComplianceStatus, KEY_ROTATION_THRESHOLD_DAYS};
pub use diagnostics::{
    collect_system_diagnostics, AuditLogDiagnostics, PolicyDiagnostics, SystemDiagnostics,
    VaultPathDiagnostics, VersionDiagnostics,
};
pub use policy::{
    init_admin_policy, resolve_config, validate_master_password,
    validate_master_password_with_min_len, AdminPolicy, ResolvedConfig, UserPolicyPreferences,
    MIN_MASTER_PASSWORD_LEN,
};
pub use security_audit::{audit_entries, SecurityAuditReport};

pub use entry::{
    RevealedSecret, SecretEntry, SecretEntryInput, SecretEntryPublic, SecretEntrySummary,
    SecretField, SecretKindTag, SecretPayload, REVEAL_SECRET_WARNING,
};
pub use error::VaultError;
pub use generator::{generate_password, PasswordGenOptions, DEFAULT_PASSWORD_LENGTH};
pub use license::{
    community_license, load_license, ActiveLicense, LicenseError, Plan, CE_MAX_USERS,
};
pub use lock::LockMetadata;
pub use mfa::{MfaSetupInfo, MfaStatus, StoredMfaConfig};
pub use probe::{resolve_probe_target, ProbeTarget};
pub use unlock::{UnlockStep, UnlockVaultResponse};
pub use url_match::{normalize_hostname, score_web_login_url_match, UrlMatchScore};
pub use vault::{SshConnectCredentials, Vault, VaultInfo};
pub use vault_user::{UnlockedUser, UserRole, VaultUser, VaultUserPublic};

pub const VAULT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn health_check() -> &'static str {
    "ok"
}
