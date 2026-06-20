pub mod crypto;
pub mod entry;
pub mod error;
pub mod format;
pub mod generator;
pub mod audit;
pub mod expiry;
pub mod policy;
pub mod probe;
pub mod url_match;
pub mod vault;

pub use audit::{audit_entries, SecurityAuditReport};
pub use policy::{validate_master_password, MIN_MASTER_PASSWORD_LEN};

pub use entry::{
    RevealedSecret, SecretEntry, SecretEntryInput, SecretEntryPublic, SecretEntrySummary,
    SecretField, SecretKindTag, SecretPayload, REVEAL_SECRET_WARNING,
};
pub use probe::{resolve_probe_target, ProbeTarget};
pub use url_match::{normalize_hostname, score_web_login_url_match, UrlMatchScore};
pub use error::VaultError;
pub use generator::{generate_password, PasswordGenOptions, DEFAULT_PASSWORD_LENGTH};
pub use vault::{Vault, VaultInfo};

pub const VAULT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn health_check() -> &'static str {
    "ok"
}
