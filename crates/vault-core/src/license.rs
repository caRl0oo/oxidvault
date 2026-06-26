// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use serde::{Deserialize, Serialize};

/// The HMAC key used to sign licenses.
///
/// TODO(production): Replace with a securely generated 32-byte key injected at
/// build time (environment variable or secret file). Never commit the real key
/// to a public repository — use `license_hmac.key` (gitignored) in production builds.
const LICENSE_HMAC_KEY: &[u8] = b"ae17e00377fd1e596df6b63d0d4b3e3b29cd53137cca15ea4e6785109f4e8971";

pub const CE_MAX_USERS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    Community,
    Enterprise,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseFile {
    pub licensee: String,
    pub plan: String,
    pub max_users: u32,
    pub valid_until: String,
    pub issued_at: String,
    pub signature: String,
}

#[derive(Debug, Clone)]
pub struct ActiveLicense {
    pub plan: Plan,
    pub licensee: String,
    /// 0 = unlimited
    pub max_users: usize,
    pub valid_until: String,
}

impl ActiveLicense {
    /// Returns true if this license allows adding another user
    /// given the current user count.
    pub fn can_add_user(&self, current_user_count: usize) -> bool {
        match self.plan {
            Plan::Enterprise => true,
            Plan::Community => current_user_count < CE_MAX_USERS,
        }
    }

    pub fn is_enterprise(&self) -> bool {
        self.plan == Plan::Enterprise
    }
}

/// Load and validate the license file.
/// Returns Community license if no file exists.
/// Returns Err if file exists but is invalid/tampered.
pub fn load_license() -> Result<ActiveLicense, LicenseError> {
    let path = license_path();

    if !path.exists() {
        return Ok(community_license());
    }

    let content = std::fs::read_to_string(&path).map_err(|_| LicenseError::ReadFailed)?;

    let file: LicenseFile =
        serde_json::from_str(&content).map_err(|_| LicenseError::InvalidFormat)?;

    verify_signature(&file)?;

    let today = today_iso();
    if file.valid_until < today {
        return Err(LicenseError::Expired {
            valid_until: file.valid_until,
        });
    }

    let plan = match file.plan.as_str() {
        "enterprise" => Plan::Enterprise,
        "community" => Plan::Community,
        _ => return Err(LicenseError::InvalidFormat),
    };

    Ok(ActiveLicense {
        plan,
        licensee: file.licensee,
        max_users: file.max_users as usize,
        valid_until: file.valid_until,
    })
}

pub fn community_license() -> ActiveLicense {
    ActiveLicense {
        plan: Plan::Community,
        licensee: "Community Edition".to_string(),
        max_users: CE_MAX_USERS,
        valid_until: "unlimited".to_string(),
    }
}

fn verify_signature(file: &LicenseFile) -> Result<(), LicenseError> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let payload = format!(
        "{}|{}|{}|{}|{}",
        file.licensee, file.plan, file.max_users, file.valid_until, file.issued_at,
    );

    let mut mac = Hmac::<Sha256>::new_from_slice(LICENSE_HMAC_KEY)
        .map_err(|_| LicenseError::SignatureInvalid)?;
    mac.update(payload.as_bytes());

    let expected = hex::encode(mac.finalize().into_bytes());

    if expected != file.signature {
        return Err(LicenseError::SignatureInvalid);
    }

    Ok(())
}

fn license_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::path::PathBuf::from(r"C:\ProgramData\OxidVault\oxidvault.license")
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::path::PathBuf::from("/etc/oxidvault/oxidvault.license")
    }
}

fn today_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum LicenseError {
    #[error("License file could not be read")]
    ReadFailed,
    #[error("License file has invalid format")]
    InvalidFormat,
    #[error("License signature is invalid — file may be tampered")]
    SignatureInvalid,
    #[error("License expired on {valid_until}")]
    Expired { valid_until: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn community_license_allows_up_to_five_users() {
        let license = community_license();
        assert!(license.can_add_user(0));
        assert!(license.can_add_user(4));
        assert!(!license.can_add_user(5));
    }

    #[test]
    fn enterprise_license_allows_unlimited_users() {
        let license = ActiveLicense {
            plan: Plan::Enterprise,
            licensee: "Test Corp".to_string(),
            max_users: 0,
            valid_until: "2099-01-01".to_string(),
        };
        assert!(license.can_add_user(100));
    }
}
