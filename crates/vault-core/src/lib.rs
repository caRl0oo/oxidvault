pub mod crypto;
pub mod entry;
pub mod error;
pub mod format;
pub mod generator;
pub mod audit;
pub mod expiry;
pub mod policy;
pub mod probe;
pub mod vault;

pub use audit::{audit_entries, SecurityAuditReport};
pub use policy::{validate_master_password, MIN_MASTER_PASSWORD_LEN};

pub use entry::{
    SecretEntry, SecretEntryInput, SecretEntrySummary, SecretKindTag, SecretPayload,
};
pub use probe::{resolve_probe_target, ProbeTarget};
pub use error::VaultError;
pub use generator::{generate_password, PasswordGenOptions, DEFAULT_PASSWORD_LENGTH};
pub use vault::{Vault, VaultInfo};

pub const VAULT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn health_check() -> &'static str {
    "ok"
}
