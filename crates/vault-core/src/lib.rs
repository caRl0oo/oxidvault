pub mod audit;
pub mod audit_export;
mod audit_secure;
pub mod crypto;
pub mod entry;
pub mod error;
pub mod expiry;
pub mod format;
pub mod generator;
pub mod lock;
pub mod path_util;
pub mod policy;
pub mod probe;
pub mod security_audit;
pub mod url_match;
pub mod vault;

pub use audit::{
    init as init_audit_log, read_audit_logs, verify_audit_chain, AuditAction, AuditLog,
    AuditLogEntry, AuditLogger,
};
pub use audit_export::{export_audit_report, ExportFormat};
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
pub use lock::LockMetadata;
pub use probe::{resolve_probe_target, ProbeTarget};
pub use url_match::{normalize_hostname, score_web_login_url_match, UrlMatchScore};
pub use vault::{Vault, VaultInfo};

pub const VAULT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn health_check() -> &'static str {
    "ok"
}
