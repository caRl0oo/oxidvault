use rand::rngs::OsRng;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::VaultError;

pub const DEFAULT_PASSWORD_LENGTH: u8 = 24;
const MIN_LENGTH: u8 = 8;
const MAX_LENGTH: u8 = 128;

const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{}|;:,.<>?";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordGenOptions {
    #[serde(default = "default_length")]
    pub length: u8,
    #[serde(default = "default_true")]
    pub uppercase: bool,
    #[serde(default = "default_true")]
    pub lowercase: bool,
    #[serde(default = "default_true")]
    pub digits: bool,
    #[serde(default = "default_true")]
    pub symbols: bool,
}

fn default_length() -> u8 {
    DEFAULT_PASSWORD_LENGTH
}

fn default_true() -> bool {
    true
}

impl Default for PasswordGenOptions {
    fn default() -> Self {
        Self {
            length: DEFAULT_PASSWORD_LENGTH,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
        }
    }
}

/// Generates a cryptographically secure random password using `OsRng` (CSPRNG).
pub fn generate_password(opts: PasswordGenOptions) -> Result<String, VaultError> {
    if opts.length < MIN_LENGTH || opts.length > MAX_LENGTH {
        return Err(VaultError::Other(format!(
            "password length must be between {MIN_LENGTH} and {MAX_LENGTH}"
        )));
    }

    let mut charset = String::new();
    let mut required: Vec<&str> = Vec::new();

    if opts.uppercase {
        charset.push_str(UPPERCASE);
        required.push(UPPERCASE);
    }
    if opts.lowercase {
        charset.push_str(LOWERCASE);
        required.push(LOWERCASE);
    }
    if opts.digits {
        charset.push_str(DIGITS);
        required.push(DIGITS);
    }
    if opts.symbols {
        charset.push_str(SYMBOLS);
        required.push(SYMBOLS);
    }

    if charset.is_empty() {
        return Err(VaultError::Other(
            "at least one character set must be enabled".into(),
        ));
    }

    let charset_bytes = charset.as_bytes();
    let mut rng = OsRng;
    let mut password: Vec<u8> = Vec::with_capacity(opts.length as usize);

    for set in &required {
        let bytes = set.as_bytes();
        password.push(bytes[rng.gen_range(0..bytes.len())]);
    }

    while password.len() < opts.length as usize {
        password.push(charset_bytes[rng.gen_range(0..charset_bytes.len())]);
    }

    for i in (1..password.len()).rev() {
        let j = rng.gen_range(0..=i);
        password.swap(i, j);
    }

    String::from_utf8(password).map_err(|e| VaultError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_default_length() {
        let pwd = generate_password(PasswordGenOptions::default()).unwrap();
        assert_eq!(pwd.len(), DEFAULT_PASSWORD_LENGTH as usize);
    }

    #[test]
    fn respects_disabled_charsets() {
        let pwd = generate_password(PasswordGenOptions {
            length: 32,
            uppercase: false,
            lowercase: true,
            digits: true,
            symbols: false,
        })
        .unwrap();
        assert_eq!(pwd.len(), 32);
        assert!(pwd
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    }

    #[test]
    fn rejects_empty_charset() {
        let err = generate_password(PasswordGenOptions {
            length: 16,
            uppercase: false,
            lowercase: false,
            digits: false,
            symbols: false,
        })
        .unwrap_err();
        assert!(err.to_string().contains("character set"));
    }
}
