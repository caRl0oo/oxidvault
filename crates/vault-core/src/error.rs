// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use thiserror::Error;

use crate::lock::LockMetadata;

/// Why a master password failed policy validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeakPasswordReason {
    TooShort,
    Blocklisted,
    LowEntropy,
}

impl WeakPasswordReason {
    pub fn as_code(&self) -> &'static str {
        match self {
            Self::TooShort => "too_short",
            Self::Blocklisted => "blocklisted",
            Self::LowEntropy => "low_entropy",
        }
    }
}

impl std::fmt::Display for WeakPasswordReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_code())
    }
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault is locked")]
    Locked,
    #[error("vault is locked by {0}")]
    LockedBy(LockMetadata),
    #[error("vault file lock lost — exclusive access cannot be verified")]
    LockLost,
    #[error("invalid master password")]
    InvalidPassword,
    #[error("invalid MFA code")]
    InvalidMfaCode,
    #[error("vault not initialized")]
    NotInitialized,
    #[error("no vault file loaded")]
    NoVaultFile,
    #[error("vault file already exists")]
    FileExists,
    #[error("entry not found")]
    EntryNotFound,
    #[error("audit log corrupted — hash chain integrity check failed")]
    AuditLogCorrupted,
    #[error("invalid vault file")]
    InvalidFormat,
    /// Payload `format_version` is newer than the on-disk header (downgrade tampering).
    #[error("vault file format downgrade detected")]
    FormatDowngrade,
    #[error("weak master password: {0}")]
    WeakPassword(WeakPasswordReason),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("{0}")]
    Other(String),
    /// Username already exists in this vault.
    #[error("username already exists: {0}")]
    UserAlreadyExists(String),
    /// Username not found.
    #[error("user not found: {0}")]
    UserNotFound(String),
    /// Operation requires Admin role.
    #[error("insufficient permissions")]
    InsufficientPermissions,
    /// Cannot remove the last admin.
    #[error("cannot remove the last admin")]
    LastAdminCannotBeRemoved,
    /// Username is empty or contains invalid characters.
    #[error("invalid username: {0}")]
    InvalidUsername(String),
    /// Wrong password for this user.
    #[error("invalid password for user")]
    InvalidUserPassword,

    /// RSA/DSA keys are not supported by this build (security hardening).
    ///
    /// Stable code for frontend mapping: `unsupported_ssh_key_type_rsa`.
    #[error("unsupported_ssh_key_type_rsa")]
    UnsupportedSshKeyType,
}
