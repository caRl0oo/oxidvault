// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! TOTP / two-factor authentication (RFC 6238) — offline, local verification.

use std::io::Cursor;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::Luma;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Secret, TOTP};
use zeroize::Zeroizing;

use crate::crypto::{self, MasterKey, NONCE_LEN};
use crate::error::VaultError;

const ISSUER: &str = "OxidVault";
const TOTP_DIGITS: usize = 6;
const TOTP_SKEW: u8 = 1;
const TOTP_STEP: u64 = 30;

/// AES-GCM–encrypted TOTP secret persisted inside the vault payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMfaConfig {
    pub enabled: bool,
    pub secret_nonce: [u8; NONCE_LEN],
    pub secret_ciphertext: Vec<u8>,
}

/// Setup metadata returned when MFA enrollment begins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaSetupInfo {
    pub account_label: String,
    pub otpauth_uri: String,
    pub qr_code_png_base64: String,
}

/// Public MFA status for settings UI (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaStatus {
    pub mfa_enabled: bool,
    pub vault_locked: bool,
}

pub(crate) struct MfaEnrollment {
    pub secret_bytes: Zeroizing<Vec<u8>>,
    pub info: MfaSetupInfo,
}

pub(crate) fn create_enrollment(vault_name: &str) -> Result<MfaEnrollment, VaultError> {
    let secret = Secret::generate_secret();
    let secret_bytes = Zeroizing::new(
        secret
            .to_bytes()
            .map_err(|e| VaultError::Crypto(e.to_string()))?,
    );

    let account_name = account_name_for_vault(vault_name);
    let totp = build_totp(&secret_bytes, &account_name)?;
    let otpauth_uri = totp.get_url();
    let qr_code_png_base64 = encode_qr_png_base64(&otpauth_uri)?;

    Ok(MfaEnrollment {
        secret_bytes,
        info: MfaSetupInfo {
            account_label: format!("{ISSUER}:{account_name}"),
            otpauth_uri,
            qr_code_png_base64,
        },
    })
}

/// Validates a 6-digit TOTP code against raw secret bytes (enrollment or decrypted secret).
pub(crate) fn verify_totp_code(
    secret_bytes: &[u8],
    vault_name: &str,
    code: &str,
) -> Result<bool, VaultError> {
    let trimmed = code.trim();
    if trimmed.len() != TOTP_DIGITS || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Ok(false);
    }

    let account_name = account_name_for_vault(vault_name);
    let totp = build_totp(secret_bytes, &account_name)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| VaultError::Other(e.to_string()))?
        .as_secs();
    Ok(totp.check(trimmed, timestamp))
}

/// Encrypts a TOTP secret for on-disk storage inside the vault payload.
pub(crate) fn encrypt_mfa_secret(
    payload_key: &MasterKey,
    secret_bytes: &[u8],
) -> Result<StoredMfaConfig, VaultError> {
    let (nonce, ciphertext) = crypto::encrypt(payload_key, secret_bytes)?;
    Ok(StoredMfaConfig {
        enabled: true,
        secret_nonce: nonce,
        secret_ciphertext: ciphertext,
    })
}

/// Decrypts a persisted TOTP secret using the vault data-encryption key.
pub(crate) fn decrypt_mfa_secret(
    payload_key: &MasterKey,
    stored: &StoredMfaConfig,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    crypto::decrypt(payload_key, &stored.secret_nonce, &stored.secret_ciphertext)
}

/// Encrypts a TOTP secret with a user-specific KEK (format v3 per-user MFA).
pub fn encrypt_mfa_secret_with_kek(
    kek: &MasterKey,
    secret_bytes: &[u8],
) -> Result<(String, String), VaultError> {
    let (nonce, ciphertext) = crypto::encrypt(kek, secret_bytes)?;
    Ok((STANDARD.encode(nonce), STANDARD.encode(ciphertext)))
}

/// Decrypts a per-user MFA secret stored in a v3 [`VaultUser`](crate::vault_user::VaultUser).
pub fn decrypt_mfa_secret_with_kek(
    kek: &MasterKey,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    let nonce_bytes = STANDARD
        .decode(nonce_b64)
        .map_err(|_| VaultError::InvalidFormat)?;
    let ciphertext = STANDARD
        .decode(ciphertext_b64)
        .map_err(|_| VaultError::InvalidFormat)?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&nonce_bytes);
    crypto::decrypt(kek, &nonce, &ciphertext)
}

/// TOTP account name for a v3 user (no colons — required by totp-rs).
pub(crate) fn v3_user_totp_account(vault_name: &str, username: &str) -> String {
    format!("{}/{}", account_name_for_vault(vault_name), username.trim())
}

/// Generates TOTP enrollment for a v3 vault user (`OxidVault:{vault}:{user}` label).
pub(crate) fn create_enrollment_for_v3_user(
    vault_name: &str,
    username: &str,
) -> Result<MfaEnrollment, VaultError> {
    let account = v3_user_totp_account(vault_name, username);
    let mut enrollment = create_enrollment_with_account(account)?;
    enrollment.info.account_label = format!(
        "{ISSUER}:{}:{}",
        account_name_for_vault(vault_name),
        username.trim()
    );
    Ok(enrollment)
}

fn create_enrollment_with_account(account: String) -> Result<MfaEnrollment, VaultError> {
    let secret = Secret::generate_secret();
    let secret_bytes = Zeroizing::new(
        secret
            .to_bytes()
            .map_err(|e| VaultError::Crypto(e.to_string()))?,
    );

    let totp = build_totp(&secret_bytes, &account)?;
    let otpauth_uri = totp.get_url();
    let qr_code_png_base64 = encode_qr_png_base64(&otpauth_uri)?;

    Ok(MfaEnrollment {
        secret_bytes,
        info: MfaSetupInfo {
            account_label: format!("{ISSUER}:{account}"),
            otpauth_uri,
            qr_code_png_base64,
        },
    })
}

/// Validates a TOTP code using an explicit account label (v3 per-user MFA).
pub(crate) fn verify_totp_code_for_account(
    secret_bytes: &[u8],
    account_name: &str,
    code: &str,
) -> Result<bool, VaultError> {
    let trimmed = code.trim();
    if trimmed.len() != TOTP_DIGITS || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Ok(false);
    }

    let totp = build_totp(secret_bytes, account_name)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| VaultError::Other(e.to_string()))?
        .as_secs();
    Ok(totp.check(trimmed, timestamp))
}

fn account_name_for_vault(vault_name: &str) -> String {
    let trimmed = vault_name.trim();
    if trimmed.is_empty() {
        "vault".to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_totp(secret_bytes: &[u8], account_name: &str) -> Result<TOTP, VaultError> {
    TOTP::new(
        Algorithm::SHA1,
        TOTP_DIGITS,
        TOTP_SKEW,
        TOTP_STEP,
        secret_bytes.to_vec(),
        Some(ISSUER.to_string()),
        account_name.to_string(),
    )
    .map_err(|e| VaultError::Crypto(e.to_string()))
}

fn encode_qr_png_base64(content: &str) -> Result<String, VaultError> {
    let code = QrCode::new(content.as_bytes()).map_err(|e| VaultError::Other(e.to_string()))?;
    let image = code.render::<Luma<u8>>().min_dimensions(256, 256).build();
    let mut png_bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| VaultError::Other(e.to_string()))?;
    Ok(STANDARD.encode(png_bytes))
}

#[cfg(test)]
mod tests {
    use super::{create_enrollment, verify_totp_code};
    use totp_rs::{Algorithm, TOTP};

    #[test]
    fn create_enrollment_returns_valid_otpauth_and_qr() {
        let enrollment = create_enrollment("Work Vault").expect("enrollment");
        assert!(enrollment.info.otpauth_uri.starts_with("otpauth://totp/"));
        assert!(enrollment.info.account_label.contains("OxidVault"));
        assert!(!enrollment.info.qr_code_png_base64.is_empty());
    }

    #[test]
    fn verify_totp_code_accepts_current_token() {
        let enrollment = create_enrollment("Test").expect("enrollment");
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            enrollment.secret_bytes.to_vec(),
            Some("OxidVault".to_string()),
            "Test".to_string(),
        )
        .expect("totp");
        let token = totp.generate_current().expect("token");
        assert!(verify_totp_code(&enrollment.secret_bytes, "Test", &token).expect("verify"));
    }

    #[test]
    fn verify_totp_code_rejects_invalid_format() {
        let enrollment = create_enrollment("Test").expect("enrollment");
        assert!(!verify_totp_code(&enrollment.secret_bytes, "Test", "12345").expect("verify"));
        assert!(!verify_totp_code(&enrollment.secret_bytes, "Test", "abcdef").expect("verify"));
    }
}
