// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! Atomic vault authentication — password and MFA are verified before any key material
//! is committed to a live [`Vault`](crate::vault::Vault) session.

use std::fmt;
use std::path::Path;

use thiserror::Error;
use zeroize::Zeroizing;

use crate::crypto::MasterKey;
use crate::error::VaultError;
use crate::format::{self, VaultFileMeta, VaultPayload};
use crate::mfa::{self, StoredMfaConfig};

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("invalid master password")]
    InvalidPassword,
    #[error("invalid MFA code")]
    InvalidMfa,
    #[error("MFA code required")]
    MfaRequired,
    #[error(transparent)]
    Vault(#[from] VaultError),
}

/// Decrypted vault material produced only after successful password (+ optional MFA) checks.
pub struct VaultHandle {
    pub(crate) meta: VaultFileMeta,
    pub(crate) kek: MasterKey,
    pub(crate) payload_key: MasterKey,
    pub(crate) payload: VaultPayload,
    pub(crate) key_created_at: u64,
    pub(crate) key_rotated_at: Option<u64>,
}

impl fmt::Debug for VaultHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VaultHandle")
            .field("name", &self.meta.name)
            .field("entry_count", &self.payload.entries.len())
            .finish_non_exhaustive()
    }
}

struct EphemeralDecrypt {
    meta: VaultFileMeta,
    kek: MasterKey,
    payload_key: MasterKey,
    payload: VaultPayload,
    key_created_at: u64,
    key_rotated_at: Option<u64>,
}

impl EphemeralDecrypt {
    fn load(path: &Path, password: &str) -> Result<Self, AuthError> {
        let meta = format::read_vault_meta(path).map_err(map_decrypt_error)?;
        let kek = MasterKey::derive_from_password(password, &meta.salt, meta.kdf)
            .map_err(map_decrypt_error)?;
        let payload_key = format::resolve_payload_key(&meta, &kek).map_err(map_decrypt_error)?;
        let (_, payload) = format::read_vault_file(path, &kek).map_err(map_decrypt_error)?;
        let key_created_at = effective_key_created_at(&meta, path);
        let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);

        Ok(Self {
            meta,
            kek,
            payload_key,
            payload,
            key_created_at,
            key_rotated_at,
        })
    }

    fn zeroize_payload_secrets(&mut self) {
        for entry in &mut self.payload.entries {
            entry.zeroize_secrets();
        }
    }

    fn abandon(mut self) {
        self.zeroize_payload_secrets();
    }

    fn into_handle(self) -> VaultHandle {
        let Self {
            meta,
            kek,
            payload_key,
            payload,
            key_created_at,
            key_rotated_at,
        } = self;
        VaultHandle {
            meta,
            kek,
            payload_key,
            payload,
            key_created_at,
            key_rotated_at,
        }
    }
}

fn map_decrypt_error(err: VaultError) -> AuthError {
    match err {
        VaultError::InvalidPassword | VaultError::Crypto(_) | VaultError::InvalidFormat => {
            AuthError::InvalidPassword
        }
        other => AuthError::Vault(other),
    }
}

fn mfa_enabled(payload: &VaultPayload) -> bool {
    payload.mfa.as_ref().is_some_and(|config| config.enabled)
}

fn verify_mfa_code(
    payload_key: &MasterKey,
    stored: &StoredMfaConfig,
    vault_name: &str,
    code: &str,
) -> Result<(), AuthError> {
    let secret = mfa::decrypt_mfa_secret(payload_key, stored)?;
    let valid = mfa::verify_totp_code(secret.as_ref(), vault_name, code)?;
    if valid {
        Ok(())
    } else {
        Err(AuthError::InvalidMfa)
    }
}

/// Atomically validates the master password and, when configured, a TOTP MFA code.
///
/// Decryption happens only in ephemeral stack memory. On any failure the function returns
/// immediately and leaves no decrypted keys on the caller's [`Vault`](crate::vault::Vault).
/// When MFA is enabled and `mfa_code` is `None`, returns [`AuthError::MfaRequired`].
pub fn unlock_vault(
    path: &Path,
    password: Zeroizing<String>,
    mfa_code: Option<Zeroizing<String>>,
) -> Result<VaultHandle, AuthError> {
    let ephemeral = EphemeralDecrypt::load(path, password.as_str())?;
    let vault_name = ephemeral.meta.name.clone();

    if mfa_enabled(&ephemeral.payload) {
        let Some(code) = mfa_code else {
            ephemeral.abandon();
            return Err(AuthError::MfaRequired);
        };
        let stored = ephemeral
            .payload
            .mfa
            .as_ref()
            .filter(|config| config.enabled)
            .ok_or(AuthError::Vault(VaultError::Other(
                "MFA configuration missing".into(),
            )))?;
        if let Err(err) =
            verify_mfa_code(&ephemeral.payload_key, stored, &vault_name, code.as_str())
        {
            ephemeral.abandon();
            return Err(err);
        }
    }

    Ok(ephemeral.into_handle())
}

fn effective_key_created_at(meta: &VaultFileMeta, path: &Path) -> u64 {
    if meta.key_created_at > 0 {
        return meta.key_created_at;
    }
    if meta.format_version == format::FORMAT_VERSION_V1 {
        return std::fs::metadata(path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
    }
    0
}
