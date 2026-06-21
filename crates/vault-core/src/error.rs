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
    #[error("vault not initialized")]
    NotInitialized,
    #[error("no vault file loaded")]
    NoVaultFile,
    #[error("vault file already exists")]
    FileExists,
    #[error("entry not found")]
    EntryNotFound,
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
}
