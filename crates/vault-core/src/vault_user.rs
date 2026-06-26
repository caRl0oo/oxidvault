// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Multi-user vault identities — per-user KEK wrapping of the shared DEK.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::{self, KdfParams, MasterKey, NONCE_LEN, SALT_LEN};
use crate::error::VaultError;

const MAX_USERNAME_LEN: usize = 64;

/// Role of a vault user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    /// Can read/write entries, cannot manage users.
    Member,
    /// Can read/write entries AND manage users (add/remove/change roles).
    Admin,
}

/// A single user entry stored in the vault header (plaintext — no secrets here).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultUser {
    /// Unique username (display name + login identifier).
    pub username: String,
    /// Role.
    pub role: UserRole,
    /// Argon2id parameters for this user's KEK derivation.
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub kdf_parallelism: u32,
    /// Salt for this user's Argon2id (16 bytes, base64-encoded).
    pub kdf_salt: String,
    /// The shared DEK, wrapped (AES-256-GCM encrypted) with this user's KEK.
    /// Nonce (12 bytes, base64) + ciphertext (base64).
    pub wrapped_dek_nonce: String,
    pub wrapped_dek_ciphertext: String,
    /// TOTP config for this user, AES-256-GCM encrypted with their KEK.
    /// None if MFA not enabled for this user.
    pub mfa_nonce: Option<String>,
    pub mfa_ciphertext: Option<String>,
    /// Timestamps.
    pub created_at: u64,
    pub password_changed_at: u64,
}

/// IPC-safe user metadata — never exposes KDF salts, wrapped DEK, or MFA blobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultUserPublic {
    pub username: String,
    pub role: UserRole,
    pub mfa_enabled: bool,
    pub created_at: u64,
    pub password_changed_at: u64,
    pub is_current_user: bool,
}

/// In-RAM representation after successful unlock — contains the live DEK.
pub struct UnlockedUser {
    pub username: String,
    pub role: UserRole,
    /// The shared DEK, unwrapped — zeroed on drop.
    pub dek: [u8; 32],
}

impl Drop for UnlockedUser {
    fn drop(&mut self) {
        self.dek.zeroize();
    }
}

/// Normalizes and validates a vault username.
pub fn validate_username(raw: &str) -> Result<String, VaultError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(VaultError::InvalidUsername(
            "username must not be empty".into(),
        ));
    }
    if trimmed.len() > MAX_USERNAME_LEN {
        return Err(VaultError::InvalidUsername(format!(
            "username must be at most {MAX_USERNAME_LEN} characters"
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(VaultError::InvalidUsername(
            "username must not contain control characters".into(),
        ));
    }
    Ok(trimmed.to_string())
}

pub fn user_mfa_enabled(user: &VaultUser) -> bool {
    user.mfa_nonce.is_some() && user.mfa_ciphertext.is_some()
}

pub fn to_public(user: &VaultUser, is_current_user: bool) -> VaultUserPublic {
    VaultUserPublic {
        username: user.username.clone(),
        role: user.role.clone(),
        mfa_enabled: user_mfa_enabled(user),
        created_at: user.created_at,
        password_changed_at: user.password_changed_at,
        is_current_user,
    }
}

pub fn derive_user_kek(user: &VaultUser, password: &str) -> Result<MasterKey, VaultError> {
    let salt = decode_salt(&user.kdf_salt)?;
    let kdf = KdfParams {
        memory_kib: user.kdf_memory_kib,
        iterations: user.kdf_iterations,
        parallelism: user.kdf_parallelism,
    };
    MasterKey::derive_from_password(password, &salt, kdf)
}

pub fn unwrap_user_dek(user: &VaultUser, kek: &MasterKey) -> Result<MasterKey, VaultError> {
    let nonce = decode_nonce(&user.wrapped_dek_nonce)?;
    let ciphertext = STANDARD
        .decode(&user.wrapped_dek_ciphertext)
        .map_err(|_| VaultError::InvalidFormat)?;
    crypto::unwrap_data_key(kek, &nonce, &ciphertext)
}

/// Builds a new [`VaultUser`] with a freshly derived KEK wrapping the shared DEK.
pub fn build_vault_user(
    username: &str,
    password: Zeroizing<String>,
    role: UserRole,
    dek: &MasterKey,
    mfa: Option<(String, String)>,
) -> Result<VaultUser, VaultError> {
    let username = validate_username(username)?;
    validate_master_password_for_user(password.as_str())?;

    let kdf = KdfParams::default();
    let salt = crypto::random_salt();
    let kek = MasterKey::derive_from_password(password.as_str(), &salt, kdf)?;
    let (dek_nonce, dek_ciphertext) = crypto::wrap_data_key(&kek, dek)?;
    let now = crate::compliance::unix_timestamp_secs();

    let (mfa_nonce, mfa_ciphertext) = match mfa {
        Some((nonce, ciphertext)) => (Some(nonce), Some(ciphertext)),
        None => (None, None),
    };

    Ok(VaultUser {
        username,
        role,
        kdf_memory_kib: kdf.memory_kib,
        kdf_iterations: kdf.iterations,
        kdf_parallelism: kdf.parallelism,
        kdf_salt: STANDARD.encode(salt),
        wrapped_dek_nonce: STANDARD.encode(dek_nonce),
        wrapped_dek_ciphertext: STANDARD.encode(dek_ciphertext),
        mfa_nonce,
        mfa_ciphertext,
        created_at: now,
        password_changed_at: now,
    })
}

/// Re-wraps the shared DEK under a new password-derived KEK for an existing user entry.
pub fn rewrap_user_dek(
    user: &mut VaultUser,
    current_password: Zeroizing<String>,
    new_password: Zeroizing<String>,
    dek: &MasterKey,
) -> Result<(), VaultError> {
    let kek = derive_user_kek(user, current_password.as_str())?;
    let _ = unwrap_user_dek(user, &kek)?;

    validate_master_password_for_user(new_password.as_str())?;

    let kdf = KdfParams::default();
    let salt = crypto::random_salt();
    let new_kek = MasterKey::derive_from_password(new_password.as_str(), &salt, kdf)?;
    let (dek_nonce, dek_ciphertext) = crypto::wrap_data_key(&new_kek, dek)?;

    user.kdf_memory_kib = kdf.memory_kib;
    user.kdf_iterations = kdf.iterations;
    user.kdf_parallelism = kdf.parallelism;
    user.kdf_salt = STANDARD.encode(salt);
    user.wrapped_dek_nonce = STANDARD.encode(dek_nonce);
    user.wrapped_dek_ciphertext = STANDARD.encode(dek_ciphertext);
    user.password_changed_at = crate::compliance::unix_timestamp_secs();
    Ok(())
}

pub fn decode_salt(encoded: &str) -> Result<[u8; SALT_LEN], VaultError> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| VaultError::InvalidFormat)?;
    if bytes.len() != SALT_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&bytes);
    Ok(salt)
}

pub fn decode_nonce(encoded: &str) -> Result<[u8; NONCE_LEN], VaultError> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| VaultError::InvalidFormat)?;
    if bytes.len() != NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&bytes);
    Ok(nonce)
}

fn validate_master_password_for_user(password: &str) -> Result<(), VaultError> {
    crate::policy::validate_master_password_with_min_len(
        password,
        crate::policy::MIN_MASTER_PASSWORD_LEN,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_username_rejects_empty_and_control_chars() {
        assert!(matches!(
            validate_username("  "),
            Err(VaultError::InvalidUsername(_))
        ));
        assert!(matches!(
            validate_username("bad\nname"),
            Err(VaultError::InvalidUsername(_))
        ));
        assert_eq!(validate_username("  alice  ").unwrap(), "alice");
    }

    #[test]
    fn build_and_unwrap_vault_user_roundtrip() {
        let dek = MasterKey::generate_data_key();
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let user = build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None)
            .expect("build user");
        let kek = derive_user_kek(&user, password.as_str()).expect("derive kek");
        let unwrapped = unwrap_user_dek(&user, &kek).expect("unwrap dek");
        assert_eq!(unwrapped.as_bytes(), dek.as_bytes());
    }
}
