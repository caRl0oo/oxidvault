// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Header-only classification for supported SSH private key types.
//!
//! Security constraints:
//! - This must not require a passphrase.
//! - It must not log or return key material.
//! - It may decode/inspect PEM envelopes to find *non-secret* identifiers.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshPrivateKeyType {
    /// Ed25519 OpenSSH / RFC 8410.
    Ed25519,
    /// ECDSA OpenSSH / SEC1 / RFC 5656.
    Ecdsa,
    /// RSA private keys (legacy PEM header or OpenSSH envelope identifier).
    Rsa,
    /// DSA private keys.
    Dsa,
    /// We could not reliably classify this key from envelope identifiers.
    Unknown,
}

pub const UNSUPPORTED_SSH_KEY_TYPE_R_SA_D_SA_CODE: &str = "unsupported_ssh_key_type_rsa";

const OPENSSH_BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
const OPENSSH_END: &str = "-----END OPENSSH PRIVATE KEY-----";

const RSA_BEGIN: &str = "-----BEGIN RSA PRIVATE KEY-----";

const DSA_BEGIN: &str = "-----BEGIN DSA PRIVATE KEY-----";

const PKCS8_BEGIN: &str = "-----BEGIN PRIVATE KEY-----";
const PKCS8_END: &str = "-----END PRIVATE KEY-----";

const ENCRYPTED_PKCS8_BEGIN: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----";
const ENCRYPTED_PKCS8_END: &str = "-----END ENCRYPTED PRIVATE KEY-----";

const EC_BEGIN: &str = "-----BEGIN EC PRIVATE KEY-----";
const EC_END: &str = "-----END EC PRIVATE KEY-----";

const PPK_PREFIX: &str = "PuTTY-User-Key-File-";

const OID_RSA_ENCRYPTION_DER: &[u8] = &[
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
];
const OID_DSA_DER: &[u8] = &[0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x01];
const OID_ED25519_DER: &[u8] = &[0x06, 0x03, 0x2b, 0x65, 0x70];
const OID_EC_PUBLIC_KEY_DER: &[u8] = &[0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];

fn normalize_key_text(input: &str) -> String {
    let mut s = input.trim().to_string();
    s = s.replace('\u{feff}', "");
    if s.contains("\\n") || s.contains("\\r\\n") {
        s = s.replace("\\r\\n", "\n");
        s = s.replace("\\n", "\n");
    }
    s = s.replace("\r\n", "\n");
    s = s.replace('\r', "\n");
    s
}

fn first_non_empty_line(input: &str) -> Option<&str> {
    input.lines().map(str::trim).find(|line| !line.is_empty())
}

fn extract_pem_body(normalized: &str, begin: &str, end: &str) -> Option<Vec<u8>> {
    let start = normalized.find(begin)? + begin.len();
    let end_pos = normalized[start..].find(end)? + start;
    let body = &normalized[start..end_pos];
    let cleaned: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned.is_empty() {
        return None;
    }

    STANDARD.decode(cleaned).ok()
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn classify_open_ssh(decoded: &[u8]) -> SshPrivateKeyType {
    if contains_bytes(decoded, b"ssh-rsa") {
        return SshPrivateKeyType::Rsa;
    }
    if contains_bytes(decoded, b"ssh-dss") {
        return SshPrivateKeyType::Dsa;
    }
    if contains_bytes(decoded, b"ssh-ed25519") {
        return SshPrivateKeyType::Ed25519;
    }
    if contains_bytes(decoded, b"ecdsa-sha2") {
        return SshPrivateKeyType::Ecdsa;
    }
    SshPrivateKeyType::Unknown
}

fn classify_pkcs8_or_ec(decoded: &[u8]) -> SshPrivateKeyType {
    if contains_bytes(decoded, OID_RSA_ENCRYPTION_DER) {
        return SshPrivateKeyType::Rsa;
    }
    if contains_bytes(decoded, OID_DSA_DER) {
        return SshPrivateKeyType::Dsa;
    }
    if contains_bytes(decoded, OID_ED25519_DER) {
        return SshPrivateKeyType::Ed25519;
    }
    if contains_bytes(decoded, OID_EC_PUBLIC_KEY_DER) {
        return SshPrivateKeyType::Ecdsa;
    }
    SshPrivateKeyType::Unknown
}

/// Detects private key type from non-secret identifiers only.
pub fn detect_private_key_type(private_key: &str) -> SshPrivateKeyType {
    let normalized = normalize_key_text(private_key);
    let first = first_non_empty_line(&normalized).unwrap_or_default();
    let lower_norm = normalized.to_ascii_lowercase();

    if first.starts_with(PPK_PREFIX) {
        // Example:
        //   PuTTY-User-Key-File-3: ssh-ed25519
        //   Key-Type: ssh-ed25519
        if let Some((_, key_type)) = first.split_once(':') {
            let value = key_type.trim().to_ascii_lowercase();
            if value.contains("ssh-rsa") {
                return SshPrivateKeyType::Rsa;
            }
            if value.contains("ssh-dss") {
                return SshPrivateKeyType::Dsa;
            }
            if value.contains("ssh-ed25519") {
                return SshPrivateKeyType::Ed25519;
            }
            if value.contains("ecdsa-sha2") {
                return SshPrivateKeyType::Ecdsa;
            }
        }
        for line in lower_norm.lines() {
            let line = line.trim();
            if let Some(value) = line.strip_prefix("key-type:") {
                let value = value.trim();
                if value.contains("ssh-rsa") {
                    return SshPrivateKeyType::Rsa;
                }
                if value.contains("ssh-dss") {
                    return SshPrivateKeyType::Dsa;
                }
                if value.contains("ssh-ed25519") {
                    return SshPrivateKeyType::Ed25519;
                }
                if value.contains("ecdsa-sha2") {
                    return SshPrivateKeyType::Ecdsa;
                }
            }
        }
        return SshPrivateKeyType::Unknown;
    }

    if first.starts_with(RSA_BEGIN) {
        return SshPrivateKeyType::Rsa;
    }
    if first.starts_with(DSA_BEGIN) {
        return SshPrivateKeyType::Dsa;
    }

    if first.starts_with(OPENSSH_BEGIN) {
        if let Some(decoded) = extract_pem_body(&normalized, OPENSSH_BEGIN, OPENSSH_END) {
            return classify_open_ssh(&decoded);
        }
        return SshPrivateKeyType::Unknown;
    }

    // For PKCS#8 and EC private key formats we attempt minimal DER/OID scanning.
    if first.starts_with(PKCS8_BEGIN) {
        if let Some(decoded) = extract_pem_body(&normalized, PKCS8_BEGIN, PKCS8_END) {
            return classify_pkcs8_or_ec(&decoded);
        }
        return SshPrivateKeyType::Unknown;
    }
    if first.starts_with(ENCRYPTED_PKCS8_BEGIN) {
        if let Some(decoded) =
            extract_pem_body(&normalized, ENCRYPTED_PKCS8_BEGIN, ENCRYPTED_PKCS8_END)
        {
            return classify_pkcs8_or_ec(&decoded);
        }
        return SshPrivateKeyType::Unknown;
    }
    if first.starts_with(EC_BEGIN) {
        if let Some(decoded) = extract_pem_body(&normalized, EC_BEGIN, EC_END) {
            return classify_pkcs8_or_ec(&decoded);
        }
        return SshPrivateKeyType::Unknown;
    }

    SshPrivateKeyType::Unknown
}

pub fn unsupported_key_type_code(t: SshPrivateKeyType) -> Option<&'static str> {
    match t {
        SshPrivateKeyType::Rsa | SshPrivateKeyType::Dsa => {
            Some(UNSUPPORTED_SSH_KEY_TYPE_R_SA_D_SA_CODE)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_legacy_rsa_header() {
        let pem = "-----BEGIN RSA PRIVATE KEY-----\nQUJDREVGRw==\n-----END RSA PRIVATE KEY-----";
        assert_eq!(detect_private_key_type(pem), SshPrivateKeyType::Rsa);
    }

    #[test]
    fn detects_legacy_dsa_header() {
        let pem = "-----BEGIN DSA PRIVATE KEY-----\nQUJDREVGRw==\n-----END DSA PRIVATE KEY-----";
        assert_eq!(detect_private_key_type(pem), SshPrivateKeyType::Dsa);
    }

    #[test]
    fn detects_ppk_version_line_ed25519() {
        let ppk = "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n";
        assert_eq!(detect_private_key_type(ppk), SshPrivateKeyType::Ed25519);
    }
}
