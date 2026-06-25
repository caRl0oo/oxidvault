// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use thiserror::Error;

use crate::lock::LockMetadata;

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
    #[error("weak master password: {0}")]
    WeakPassword(String),
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
}
