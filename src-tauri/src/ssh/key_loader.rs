// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! Runtime-only SSH private key loading from vault material.
//!
//! Keys must never be embedded in source code. Callers receive key bytes exclusively
//! from [`crate::commands::ssh::ssh_connect`] via `Vault::extract_ssh_credentials`.

use data_encoding::BASE64_MIME;
use russh::keys::{self, decode_openssh, PrivateKey};

const OPENSSH_BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
const OPENSSH_END: &str = "-----END OPENSSH PRIVATE KEY-----";
const RSA_BEGIN: &str = "-----BEGIN RSA PRIVATE KEY-----";
const RSA_END: &str = "-----END RSA PRIVATE KEY-----";
const PKCS8_BEGIN: &str = "-----BEGIN PRIVATE KEY-----";
const PKCS8_END: &str = "-----END PRIVATE KEY-----";
const EC_BEGIN: &str = "-----BEGIN EC PRIVATE KEY-----";
const EC_END: &str = "-----END EC PRIVATE KEY-----";
const ENCRYPTED_PKCS8_BEGIN: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
const ENCRYPTED_PKCS8_END: &str = "-----END ENCRYPTED PRIVATE KEY-----";
const PPK_PREFIX: &str = "PuTTY-User-Key-File-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PemKeyFormat {
    OpenSsh,
    LegacyRsa,
    Pkcs8,
    EcPkcs8,
    Pkcs8Encrypted,
    Ppk,
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

/// Loads a private key from vault-provided PEM/PPK text (never from source files).
pub fn load_private_key_from_vault(
    raw: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, String> {
    let pass = effective_passphrase(passphrase);

    let normalized = match normalize_vault_key_material(raw) {
        Ok(text) => text,
        Err(failure) => return Err(failure.user_message(None)),
    };

    let format = match detect_key_format(&normalized) {
        Ok(format) => format,
        Err(failure) => return Err(failure.user_message(None)),
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

fn normalize_vault_key_material(raw: &str) -> Result<String, KeyLoadFailure> {
    reject_public_key_lines(raw)?;

    let mut text = raw.trim().to_string();
    if let Some(stripped) = text.strip_prefix('\u{FEFF}') {
        text = stripped.to_string();
    }
    if text.contains("\\n") || text.contains("\\r\\n") {
        text = text.replace("\\r\\n", "\n");
        text = text.replace("\\n", "\n");
    }
    text = text.replace("\r\n", "\n");
    text = text.replace('\r', "\n");
    text = reflow_pem_if_needed(&text);

    let lines: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();

    if lines.is_empty() {
        return Err(KeyLoadFailure::MissingBeginHeader);
    }

    if lines[0].starts_with(PPK_PREFIX) {
        return Ok(lines.join("\n"));
    }

    let format =
        detect_format_from_begin_line(&lines[0]).ok_or(KeyLoadFailure::MissingBeginHeader)?;
    let (begin_marker, end_marker) = pem_markers(format);

    if lines[0] != begin_marker {
        return Err(KeyLoadFailure::MissingBeginHeader);
    }

    match lines.last().map(String::as_str) {
        Some(end) if end == end_marker => {}
        Some(_) => return Err(KeyLoadFailure::BeginEndMismatch),
        None => return Err(KeyLoadFailure::MissingEndHeader),
    }

    if lines.len() < 3 {
        return Err(KeyLoadFailure::EmptyPemBody);
    }

    for line in lines.iter().skip(1).take(lines.len().saturating_sub(2)) {
        if !line.chars().all(is_base64_char) {
            return Err(KeyLoadFailure::InvalidBase64Body);
        }
    }

    Ok(lines.join("\n"))
}

fn detect_key_format(normalized: &str) -> Result<PemKeyFormat, KeyLoadFailure> {
    let first = normalized.lines().next().map(str::trim).unwrap_or_default();
    if first.starts_with(PPK_PREFIX) {
        return Ok(PemKeyFormat::Ppk);
    }
    detect_format_from_begin_line(first).ok_or(KeyLoadFailure::MissingBeginHeader)
}

fn detect_format_from_begin_line(line: &str) -> Option<PemKeyFormat> {
    match line {
        OPENSSH_BEGIN => Some(PemKeyFormat::OpenSsh),
        RSA_BEGIN => Some(PemKeyFormat::LegacyRsa),
        PKCS8_BEGIN => Some(PemKeyFormat::Pkcs8),
        EC_BEGIN => Some(PemKeyFormat::EcPkcs8),
        ENCRYPTED_PKCS8_BEGIN => Some(PemKeyFormat::Pkcs8Encrypted),
        _ => None,
    }
}

fn pem_markers(format: PemKeyFormat) -> (&'static str, &'static str) {
    match format {
        PemKeyFormat::OpenSsh => (OPENSSH_BEGIN, OPENSSH_END),
        PemKeyFormat::LegacyRsa => (RSA_BEGIN, RSA_END),
        PemKeyFormat::Pkcs8 => (PKCS8_BEGIN, PKCS8_END),
        PemKeyFormat::EcPkcs8 => (EC_BEGIN, EC_END),
        PemKeyFormat::Pkcs8Encrypted => (ENCRYPTED_PKCS8_BEGIN, ENCRYPTED_PKCS8_END),
        PemKeyFormat::Ppk => ("", ""),
    }
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
    let body = extract_pem_body(normalized, OPENSSH_BEGIN, OPENSSH_END)?;
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

fn reject_public_key_lines(raw: &str) -> Result<(), KeyLoadFailure> {
    let trimmed = raw.trim();
    if trimmed.starts_with("ssh-ed25519 ")
        || trimmed.starts_with("ssh-rsa ")
        || trimmed.starts_with("ecdsa-sha2-")
        || trimmed.starts_with("ssh-dss ")
    {
        return Err(KeyLoadFailure::PublicKeyNotPrivateKey);
    }
    Ok(())
}

fn reflow_pem_if_needed(s: &str) -> String {
    const BEGIN: &str = "-----BEGIN ";
    if !s.contains(BEGIN) {
        return s.to_string();
    }
    if let Some(first) = s.lines().next().map(str::trim) {
        if first.starts_with(BEGIN) && first.ends_with("-----") && first.len() < 64 {
            return s.to_string();
        }
    }
    reflow_glued_pem(s)
}

fn reflow_glued_pem(s: &str) -> String {
    let begin_pos = match s.find("-----BEGIN ") {
        Some(pos) => pos,
        None => return s.to_string(),
    };
    let end_pos = match s.find("-----END ") {
        Some(pos) if pos > begin_pos => pos,
        _ => return s.to_string(),
    };

    let header_region = &s[begin_pos..end_pos];
    let Some(header_close) = header_region.rfind("-----") else {
        return s.to_string();
    };
    let header_end = begin_pos + header_close + 5;

    let begin_line = s[begin_pos..header_end].trim();
    let body = s[header_end..end_pos].trim();
    let end_close = s[end_pos..]
        .rfind("-----")
        .map(|i| end_pos + i + 5)
        .unwrap_or(s.len());
    let end_line = s[end_pos..end_close].trim();

    if begin_line.is_empty() || body.is_empty() || end_line.is_empty() {
        return s.to_string();
    }

    format!("{begin_line}\n{body}\n{end_line}")
}

fn is_base64_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='
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
            Self::UnsupportedKeyType => match format {
                Some(PemKeyFormat::LegacyRsa) => {
                    "Unsupported legacy RSA key type for this build".into()
                }
                Some(PemKeyFormat::OpenSsh) => {
                    "Unsupported key type inside OpenSSH envelope".into()
                }
                _ => "Unsupported SSH private key type".into(),
            },
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

    /// Synthetic PEM skeleton for structure tests — not a real private key.
    const SYNTHETIC_OPENSSH_PEM: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
YWJjZA==
-----END OPENSSH PRIVATE KEY-----";

    const SYNTHETIC_RSA_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----
QUJDREFF=
-----END RSA PRIVATE KEY-----";

    #[test]
    fn rejects_public_key_material() {
        let err = normalize_vault_key_material(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .unwrap_err();
        assert_eq!(err, KeyLoadFailure::PublicKeyNotPrivateKey);
    }

    #[test]
    fn requires_begin_header() {
        let err = normalize_vault_key_material("not a key").unwrap_err();
        assert_eq!(err, KeyLoadFailure::MissingBeginHeader);
    }

    #[test]
    fn requires_matching_end_header() {
        let bad = "-----BEGIN OPENSSH PRIVATE KEY-----\nQUJDREFF=\n-----END RSA PRIVATE KEY-----";
        let err = normalize_vault_key_material(bad).unwrap_err();
        assert_eq!(err, KeyLoadFailure::BeginEndMismatch);
    }

    #[test]
    fn normalizes_literal_backslash_n() {
        let escaped = SYNTHETIC_OPENSSH_PEM.replace('\n', "\\n");
        let normalized = normalize_vault_key_material(&escaped).unwrap();
        assert!(normalized.contains('\n'));
        assert!(normalized.starts_with(OPENSSH_BEGIN));
    }

    #[test]
    fn normalizes_one_line_pem() {
        let one_line = SYNTHETIC_OPENSSH_PEM.replace('\n', "");
        let normalized = normalize_vault_key_material(&one_line).unwrap();
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
        let normalized = normalize_vault_key_material(SYNTHETIC_OPENSSH_PEM).unwrap();
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
