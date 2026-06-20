use crate::error::VaultError;

pub const MIN_MASTER_PASSWORD_LEN: usize = 12;

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
    if password.len() < MIN_MASTER_PASSWORD_LEN {
        return Err(VaultError::WeakPassword(format!(
            "master password must be at least {MIN_MASTER_PASSWORD_LEN} characters"
        )));
    }

    let normalized = normalize_for_check(password);
    if is_common_password(&normalized) {
        return Err(VaultError::WeakPassword(
            "master password is too common".into(),
        ));
    }

    Ok(())
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

    #[test]
    fn rejects_short_password() {
        assert!(validate_master_password("short").is_err());
    }

    #[test]
    fn rejects_common_password() {
        assert!(validate_master_password("abc123456789").is_err());
    }

    #[test]
    fn accepts_strong_password() {
        assert!(validate_master_password("correct-horse-battery-staple").is_ok());
    }
}
