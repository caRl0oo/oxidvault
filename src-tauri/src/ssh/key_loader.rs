// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Runtime-only SSH private key loading from vault material.
//!
//! Keys must never be embedded in source code. Callers receive key bytes exclusively
//! from [`crate::commands::ssh::ssh_connect`] via `Vault::extract_ssh_credentials`.

use data_encoding::BASE64_MIME;
use russh::keys::{self, decode_openssh, PrivateKey};
use vault_core::ssh_key_parse::{
    detect_key_format, normalize_ssh_key_material, pem_markers, PemKeyFormat, SshKeyParseFailure,
};
use vault_core::ssh_key_type::{
    detect_private_key_type, unsupported_key_type_code, SshPrivateKeyType,
};

/// Classifies a private SSH key string from non-secret envelope identifiers only.
///
/// This does not require a passphrase. It never logs key material.
pub fn classify_private_key_type(private_key: &str) -> SshPrivateKeyType {
    detect_private_key_type(private_key)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyLoadFailure {
    PublicKeyNotPrivateKey,
    MissingBeginHeader,
    MissingEndHeader,
    BeginEndMismatch,
    EmptyPemBody,
    InvalidBase64Body,
    EncryptedKeyMissingPassphrase,
    UnsupportedKeyType,
    DecodeFailed,
}

impl From<SshKeyParseFailure> for KeyLoadFailure {
    fn from(value: SshKeyParseFailure) -> Self {
        match value {
            SshKeyParseFailure::InvalidUtf8 => KeyLoadFailure::DecodeFailed,
            SshKeyParseFailure::PublicKeyNotPrivateKey => KeyLoadFailure::PublicKeyNotPrivateKey,
            SshKeyParseFailure::MissingBeginHeader => KeyLoadFailure::MissingBeginHeader,
            SshKeyParseFailure::MissingEndHeader => KeyLoadFailure::MissingEndHeader,
            SshKeyParseFailure::BeginEndMismatch => KeyLoadFailure::BeginEndMismatch,
            SshKeyParseFailure::EmptyPemBody => KeyLoadFailure::EmptyPemBody,
            SshKeyParseFailure::InvalidBase64Body => KeyLoadFailure::InvalidBase64Body,
            SshKeyParseFailure::InvalidPpkStructure => KeyLoadFailure::DecodeFailed,
        }
    }
}

/// Loads a private key from vault-provided PEM/PPK text (never from source files).
pub fn load_private_key_from_vault(
    raw: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, String> {
    let pass = effective_passphrase(passphrase);

    let normalized = match normalize_ssh_key_material(raw) {
        Ok(text) => text,
        Err(failure) => return Err(KeyLoadFailure::from(failure).user_message(None)),
    };

    // Connect-time hardening: reject RSA/DSA deterministically with a stable code.
    if let Some(code) = unsupported_key_type_code(classify_private_key_type(&normalized)) {
        return Err(code.to_string());
    }

    let format = match detect_key_format(&normalized) {
        Ok(format) => format,
        Err(failure) => return Err(KeyLoadFailure::from(failure).user_message(None)),
    };

    match parse_by_format(format, &normalized, pass) {
        Ok(key) => {
            if key.is_encrypted() {
                return Err(
                    KeyLoadFailure::EncryptedKeyMissingPassphrase.user_message(Some(format))
                );
            }
            Ok(key)
        }
        Err(failure) => Err(failure.user_message(Some(format))),
    }
}

fn effective_passphrase(passphrase: Option<&str>) -> Option<&str> {
    passphrase.filter(|p| !p.is_empty())
}

fn parse_by_format(
    format: PemKeyFormat,
    normalized: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, KeyLoadFailure> {
    match format {
        PemKeyFormat::OpenSsh => parse_openssh_pem(normalized, passphrase),
        PemKeyFormat::LegacyRsa => parse_with_russh_decoder(normalized, passphrase, format),
        PemKeyFormat::Pkcs8 | PemKeyFormat::EcPkcs8 | PemKeyFormat::Pkcs8Encrypted => {
            parse_with_russh_decoder(normalized, passphrase, format)
        }
        PemKeyFormat::Ppk => parse_with_russh_decoder(normalized, passphrase, format),
    }
}

/// OpenSSH PEM (Ed25519, ECDSA, RSA in OpenSSH envelope) via russh format module.
fn parse_openssh_pem(
    normalized: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, KeyLoadFailure> {
    let (begin, end) = pem_markers(PemKeyFormat::OpenSsh);
    let body = extract_pem_body(normalized, begin, end)?;
    let bytes = BASE64_MIME
        .decode(body.as_bytes())
        .map_err(|_| KeyLoadFailure::InvalidBase64Body)?;

    decode_openssh(&bytes, passphrase).map_err(map_russh_error)
}

fn parse_with_russh_decoder(
    normalized: &str,
    passphrase: Option<&str>,
    _format: PemKeyFormat,
) -> Result<PrivateKey, KeyLoadFailure> {
    keys::decode_secret_key(normalized, passphrase).map_err(|err| match err {
        keys::Error::UnsupportedKeyType { .. } => KeyLoadFailure::UnsupportedKeyType,
        keys::Error::KeyIsEncrypted => KeyLoadFailure::EncryptedKeyMissingPassphrase,
        _ => KeyLoadFailure::DecodeFailed,
    })
}

fn extract_pem_body(normalized: &str, begin: &str, end: &str) -> Result<String, KeyLoadFailure> {
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.first().copied() != Some(begin) {
        return Err(KeyLoadFailure::MissingBeginHeader);
    }
    if lines.last().copied() != Some(end) {
        return Err(KeyLoadFailure::MissingEndHeader);
    }
    let body: String = lines
        .iter()
        .skip(1)
        .take(lines.len().saturating_sub(2))
        .copied()
        .collect();
    if body.is_empty() {
        return Err(KeyLoadFailure::EmptyPemBody);
    }
    Ok(body)
}

fn map_russh_error(err: keys::Error) -> KeyLoadFailure {
    match err {
        keys::Error::KeyIsEncrypted => KeyLoadFailure::EncryptedKeyMissingPassphrase,
        keys::Error::UnsupportedKeyType { .. } => KeyLoadFailure::UnsupportedKeyType,
        _ => KeyLoadFailure::DecodeFailed,
    }
}

impl KeyLoadFailure {
    fn user_message(self, format: Option<PemKeyFormat>) -> String {
        match self {
            Self::PublicKeyNotPrivateKey => {
                "Stored SSH material is a public key, not a private key (PEM or PPK expected)".into()
            }
            Self::MissingBeginHeader => {
                "Invalid private key: PEM BEGIN header missing (expected OpenSSH, PKCS#8, or RSA PEM)"
                    .into()
            }
            Self::MissingEndHeader => {
                "Invalid private key: PEM END header missing".into()
            }
            Self::BeginEndMismatch => {
                "Invalid private key: PEM BEGIN and END headers do not match".into()
            }
            Self::EmptyPemBody => "Invalid private key: PEM body is empty".into(),
            Self::InvalidBase64Body => "Invalid private key: PEM body is not valid Base64".into(),
            Self::EncryptedKeyMissingPassphrase => {
                "The private key is encrypted; enter the key passphrase in the vault entry".into()
            }
            Self::UnsupportedKeyType => "unsupported_ssh_key_type_rsa".into(),
            Self::DecodeFailed => match format {
                Some(PemKeyFormat::OpenSsh) => {
                    "Invalid private key: OpenSSH envelope could not be decoded".into()
                }
                Some(PemKeyFormat::LegacyRsa) => {
                    "Invalid private key: legacy RSA PEM could not be decoded".into()
                }
                Some(PemKeyFormat::Pkcs8) | Some(PemKeyFormat::EcPkcs8) => {
                    "Invalid private key: PKCS#8 material could not be decoded".into()
                }
                Some(PemKeyFormat::Pkcs8Encrypted) => {
                    "Invalid private key: encrypted PKCS#8 material could not be decoded".into()
                }
                Some(PemKeyFormat::Ppk) => {
                    "Invalid private key: PuTTY PPK could not be decoded".into()
                }
                None => "Invalid private key: could not be decoded".into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vault_core::ssh_key_parse::{OPENSSH_BEGIN, OPENSSH_END};

    /// Synthetic PEM skeleton for structure tests — not a real private key.
    const SYNTHETIC_OPENSSH_PEM: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
YWJjZA==
-----END OPENSSH PRIVATE KEY-----";

    const SYNTHETIC_RSA_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----
QUJDREFF=
-----END RSA PRIVATE KEY-----";

    #[test]
    fn rejects_public_key_material() {
        let err = normalize_ssh_key_material(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .unwrap_err();
        assert_eq!(err, SshKeyParseFailure::PublicKeyNotPrivateKey);
    }

    #[test]
    fn requires_begin_header() {
        let err = normalize_ssh_key_material("not a key").unwrap_err();
        assert_eq!(err, SshKeyParseFailure::MissingBeginHeader);
    }

    #[test]
    fn requires_matching_end_header() {
        let bad = "-----BEGIN OPENSSH PRIVATE KEY-----\nQUJDREFF=\n-----END RSA PRIVATE KEY-----";
        let err = normalize_ssh_key_material(bad).unwrap_err();
        assert_eq!(err, SshKeyParseFailure::BeginEndMismatch);
    }

    #[test]
    fn normalizes_literal_backslash_n() {
        let escaped = SYNTHETIC_OPENSSH_PEM.replace('\n', "\\n");
        let normalized = normalize_ssh_key_material(&escaped).unwrap();
        assert!(normalized.contains('\n'));
        assert!(normalized.starts_with(OPENSSH_BEGIN));
    }

    #[test]
    fn normalizes_one_line_pem() {
        let one_line = SYNTHETIC_OPENSSH_PEM.replace('\n', "");
        let normalized = normalize_ssh_key_material(&one_line).unwrap();
        assert_eq!(normalized.lines().next().unwrap(), OPENSSH_BEGIN);
        assert_eq!(normalized.lines().last().unwrap(), OPENSSH_END);
    }

    #[test]
    fn detects_openssh_vs_legacy_rsa() {
        assert_eq!(
            detect_key_format(SYNTHETIC_OPENSSH_PEM).unwrap(),
            PemKeyFormat::OpenSsh
        );
        assert_eq!(
            detect_key_format(SYNTHETIC_RSA_PEM).unwrap(),
            PemKeyFormat::LegacyRsa
        );
    }

    #[test]
    fn synthetic_openssh_decode_fails_without_real_key_material() {
        let normalized = normalize_ssh_key_material(SYNTHETIC_OPENSSH_PEM).unwrap();
        let err = parse_openssh_pem(&normalized, None).unwrap_err();
        assert_eq!(err, KeyLoadFailure::DecodeFailed);
    }

    /// Optional integration test: set `OXIDVAULT_TEST_SSH_KEY_PATH` to a local key file.
    #[test]
    #[ignore = "requires OXIDVAULT_TEST_SSH_KEY_PATH pointing to a local private key file"]
    fn loads_key_from_env_file() {
        let path = std::env::var("OXIDVAULT_TEST_SSH_KEY_PATH")
            .expect("OXIDVAULT_TEST_SSH_KEY_PATH must be set");
        let material = std::fs::read_to_string(&path).expect("read key file");
        load_private_key_from_vault(&material, None).expect("load key from env file");
    }
}
