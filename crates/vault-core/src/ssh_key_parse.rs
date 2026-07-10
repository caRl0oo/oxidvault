// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Structural validation for SSH private key material (PEM / PPK).
//!
//! Pure parsing only — no russh decode, no passphrase handling. Used by the desktop
//! shell before crypto decode and by cargo-fuzz targets.

use crate::ssh_key_type::{detect_private_key_type, SshPrivateKeyType};

pub const OPENSSH_BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
pub const OPENSSH_END: &str = "-----END OPENSSH PRIVATE KEY-----";
pub const RSA_BEGIN: &str = "-----BEGIN RSA PRIVATE KEY-----";
pub const RSA_END: &str = "-----END RSA PRIVATE KEY-----";
pub const PKCS8_BEGIN: &str = "-----BEGIN PRIVATE KEY-----";
pub const PKCS8_END: &str = "-----END PRIVATE KEY-----";
pub const EC_BEGIN: &str = "-----BEGIN EC PRIVATE KEY-----";
pub const EC_END: &str = "-----END EC PRIVATE KEY-----";
pub const ENCRYPTED_PKCS8_BEGIN: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
pub const ENCRYPTED_PKCS8_END: &str = "-----END ENCRYPTED PRIVATE KEY-----";
pub const PPK_PREFIX: &str = "PuTTY-User-Key-File-";

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
pub enum SshKeyParseFailure {
    InvalidUtf8,
    PublicKeyNotPrivateKey,
    MissingBeginHeader,
    MissingEndHeader,
    BeginEndMismatch,
    EmptyPemBody,
    InvalidBase64Body,
    InvalidPpkStructure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SshKeyParseOutcome {
    pub format: PemKeyFormat,
    pub key_type: SshPrivateKeyType,
}

/// Classifies private SSH key material from non-secret envelope identifiers only.
pub fn classify_private_key_type(private_key: &str) -> SshPrivateKeyType {
    detect_private_key_type(private_key)
}

/// Parses and structurally validates SSH private key bytes (PEM or PPK envelope).
pub fn parse_ssh_private_key_bytes(data: &[u8]) -> Result<SshKeyParseOutcome, SshKeyParseFailure> {
    let text = std::str::from_utf8(data).map_err(|_| SshKeyParseFailure::InvalidUtf8)?;
    let normalized = normalize_ssh_key_material(text)?;
    let format = detect_key_format(&normalized)?;
    if matches!(format, PemKeyFormat::Ppk) {
        validate_ppk_structure(&normalized)?;
    }
    let key_type = classify_private_key_type(&normalized);
    Ok(SshKeyParseOutcome { format, key_type })
}

/// Normalizes vault-stored key text and validates PEM/PPK envelope structure.
pub fn normalize_ssh_key_material(raw: &str) -> Result<String, SshKeyParseFailure> {
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
        return Err(SshKeyParseFailure::MissingBeginHeader);
    }

    if lines[0].starts_with(PPK_PREFIX) {
        return Ok(lines.join("\n"));
    }

    let format =
        detect_format_from_begin_line(&lines[0]).ok_or(SshKeyParseFailure::MissingBeginHeader)?;
    let (begin_marker, end_marker) = pem_markers(format);

    if lines[0] != begin_marker {
        return Err(SshKeyParseFailure::MissingBeginHeader);
    }

    match lines.last().map(String::as_str) {
        Some(end) if end == end_marker => {}
        Some(_) => return Err(SshKeyParseFailure::BeginEndMismatch),
        None => return Err(SshKeyParseFailure::MissingEndHeader),
    }

    if lines.len() < 3 {
        return Err(SshKeyParseFailure::EmptyPemBody);
    }

    for line in lines.iter().skip(1).take(lines.len().saturating_sub(2)) {
        if !line.chars().all(is_base64_char) {
            return Err(SshKeyParseFailure::InvalidBase64Body);
        }
    }

    Ok(lines.join("\n"))
}

pub fn detect_key_format(normalized: &str) -> Result<PemKeyFormat, SshKeyParseFailure> {
    let first = normalized.lines().next().map(str::trim).unwrap_or_default();
    if first.starts_with(PPK_PREFIX) {
        return Ok(PemKeyFormat::Ppk);
    }
    detect_format_from_begin_line(first).ok_or(SshKeyParseFailure::MissingBeginHeader)
}

pub fn detect_format_from_begin_line(line: &str) -> Option<PemKeyFormat> {
    match line {
        OPENSSH_BEGIN => Some(PemKeyFormat::OpenSsh),
        RSA_BEGIN => Some(PemKeyFormat::LegacyRsa),
        PKCS8_BEGIN => Some(PemKeyFormat::Pkcs8),
        EC_BEGIN => Some(PemKeyFormat::EcPkcs8),
        ENCRYPTED_PKCS8_BEGIN => Some(PemKeyFormat::Pkcs8Encrypted),
        _ => None,
    }
}

pub fn pem_markers(format: PemKeyFormat) -> (&'static str, &'static str) {
    match format {
        PemKeyFormat::OpenSsh => (OPENSSH_BEGIN, OPENSSH_END),
        PemKeyFormat::LegacyRsa => (RSA_BEGIN, RSA_END),
        PemKeyFormat::Pkcs8 => (PKCS8_BEGIN, PKCS8_END),
        PemKeyFormat::EcPkcs8 => (EC_BEGIN, EC_END),
        PemKeyFormat::Pkcs8Encrypted => (ENCRYPTED_PKCS8_BEGIN, ENCRYPTED_PKCS8_END),
        PemKeyFormat::Ppk => ("", ""),
    }
}

fn validate_ppk_structure(normalized: &str) -> Result<(), SshKeyParseFailure> {
    let mut saw_version = false;
    let mut saw_key_type = false;
    for line in normalized.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(after) = line.strip_prefix(PPK_PREFIX) {
            saw_version = true;
            if !after.trim().is_empty() {
                saw_key_type = true;
            }
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("key-type:") {
            saw_key_type = true;
        }
    }
    if saw_version && saw_key_type {
        Ok(())
    } else {
        Err(SshKeyParseFailure::InvalidPpkStructure)
    }
}

fn reject_public_key_lines(raw: &str) -> Result<(), SshKeyParseFailure> {
    let trimmed = raw.trim();
    if trimmed.starts_with("ssh-ed25519 ")
        || trimmed.starts_with("ssh-rsa ")
        || trimmed.starts_with("ecdsa-sha2-")
        || trimmed.starts_with("ssh-dss ")
    {
        return Err(SshKeyParseFailure::PublicKeyNotPrivateKey);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_key_type::SshPrivateKeyType;

    /// Synthetic PEM skeleton for structure tests — not a real private key.
    const SYNTHETIC_OPENSSH_PEM: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
YWJjZA==
-----END OPENSSH PRIVATE KEY-----";

    const SYNTHETIC_RSA_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----
QUJDREFF=
-----END RSA PRIVATE KEY-----";

    /// Minimal PPK envelope for structural tests — not a real key (no key material lines).
    fn minimal_ppk_skeleton() -> String {
        format!(
            "{vendor}-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: fuzz-fixture-not-a-real-key\n",
            vendor = "PuTTY",
        )
    }

    #[test]
    fn rejects_public_key_material() {
        let err = normalize_ssh_key_material("ssh-ed25519 AAAA").unwrap_err();
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
    fn parse_bytes_classifies_rsa_as_unsupported_type() {
        let outcome = parse_ssh_private_key_bytes(SYNTHETIC_RSA_PEM.as_bytes()).unwrap();
        assert_eq!(outcome.format, PemKeyFormat::LegacyRsa);
        assert_eq!(outcome.key_type, SshPrivateKeyType::Rsa);
    }

    #[test]
    fn parse_ppk_skeleton() {
        let ppk = minimal_ppk_skeleton();
        let outcome = parse_ssh_private_key_bytes(ppk.as_bytes()).unwrap();
        assert_eq!(outcome.format, PemKeyFormat::Ppk);
        assert_eq!(outcome.key_type, SshPrivateKeyType::Ed25519);
    }

    #[test]
    #[ignore = "run manually to refresh fuzz/corpus/ssh_key seeds"]
    fn write_fuzz_ssh_corpus_seeds() {
        use std::path::PathBuf;

        let corpus_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fuzz/corpus/ssh_key");
        std::fs::create_dir_all(&corpus_dir).unwrap();
        std::fs::write(corpus_dir.join("ppk_v3_skeleton"), minimal_ppk_skeleton()).unwrap();
        std::fs::write(
            corpus_dir.join("openssh_pem_skeleton"),
            SYNTHETIC_OPENSSH_PEM,
        )
        .unwrap();
        std::fs::write(corpus_dir.join("rsa_pem_header"), SYNTHETIC_RSA_PEM).unwrap();
    }
}
