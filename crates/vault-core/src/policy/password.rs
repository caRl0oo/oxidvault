// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use crate::error::{VaultError, WeakPasswordReason};

pub const MIN_MASTER_PASSWORD_LEN: usize = 12;
const MIN_ZXCVBN_SCORE: u8 = 2;

const COMMON_PASSWORDS: &[&str] = &[
    "password",
    "password1",
    "password12",
    "password123",
    "123456",
    "1234567",
    "12345678",
    "123456789",
    "1234567890",
    "admin",
    "admin123",
    "administrator",
    "letmein",
    "welcome",
    "welcome1",
    "qwerty",
    "qwerty123",
    "abc123",
    "abc123456789",
    "passwort",
    "passwort123",
    "master",
    "master123",
    "changeme",
    "secret",
    "secret123",
    "oxidvault",
    "vault123",
    "11111111",
    "00000000",
    "iloveyou",
    "sunshine",
    "monkey",
    "dragon",
    "football",
    "baseball",
    "trustno1",
    "superman",
    "batman",
    "access",
    "root",
    "toor",
    "P@ssw0rd",
    "Passw0rd",
];

pub fn validate_master_password(password: &str) -> Result<(), VaultError> {
    validate_master_password_with_min_len(password, MIN_MASTER_PASSWORD_LEN)
}

pub fn validate_master_password_with_min_len(
    password: &str,
    min_len: usize,
) -> Result<(), VaultError> {
    if password.len() < min_len {
        return Err(VaultError::WeakPassword(WeakPasswordReason::TooShort));
    }

    let normalized = normalize_for_check(password);
    if is_common_password(&normalized) {
        return Err(VaultError::WeakPassword(WeakPasswordReason::Blocklisted));
    }

    if !meets_entropy_threshold(password) {
        return Err(VaultError::WeakPassword(WeakPasswordReason::LowEntropy));
    }

    Ok(())
}

fn meets_entropy_threshold(password: &str) -> bool {
    zxcvbn::zxcvbn(password, &[]).score() as u8 >= MIN_ZXCVBN_SCORE
}

fn normalize_for_check(password: &str) -> String {
    password.trim().to_lowercase()
}

fn is_common_password(normalized: &str) -> bool {
    COMMON_PASSWORDS
        .iter()
        .any(|&blocked| normalize_for_check(blocked) == normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultError;

    fn weak_reason(result: Result<(), VaultError>) -> Option<WeakPasswordReason> {
        match result {
            Err(VaultError::WeakPassword(reason)) => Some(reason),
            _ => None,
        }
    }

    #[test]
    fn rejects_short_password() {
        assert_eq!(
            weak_reason(validate_master_password("short")),
            Some(WeakPasswordReason::TooShort)
        );
    }

    #[test]
    fn rejects_common_password() {
        assert_eq!(
            weak_reason(validate_master_password("abc123456789")),
            Some(WeakPasswordReason::Blocklisted)
        );
    }

    #[test]
    fn rejects_low_entropy_password() {
        assert_eq!(
            weak_reason(validate_master_password("aaaaaaaaaaaa")),
            Some(WeakPasswordReason::LowEntropy)
        );
    }

    #[test]
    fn accepts_strong_password() {
        assert!(validate_master_password("correct-horse-battery-staple").is_ok());
    }
}
