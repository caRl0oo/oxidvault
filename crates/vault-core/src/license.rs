// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use serde::{Deserialize, Serialize};

/// Public key injected at build time via OXIDVAULT_PUBLIC_KEY env var.
/// Never hardcoded — safe for open source repository.
/// Empty string = license validation disabled (CE mode only).
const LICENSE_PUBLIC_KEY: &str = env!("OXIDVAULT_PUBLIC_KEY");

pub const CE_MAX_USERS: usize = 5;

#[derive(Debug, Clone, PartialEq)]
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
    pub max_users: usize,
    pub valid_until: String,
}

impl ActiveLicense {
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

pub fn community_license() -> ActiveLicense {
    ActiveLicense {
        plan: Plan::Community,
        licensee: "Community Edition".to_string(),
        max_users: CE_MAX_USERS,
        valid_until: "unlimited".to_string(),
    }
}

/// Load and validate license file.
/// Returns Community Edition if:
/// - No license file exists
/// - Public key not set at build time
/// - Signature invalid
/// - License expired
///
/// Returns Err only if file exists but is malformed JSON.
pub fn load_license() -> Result<ActiveLicense, LicenseError> {
    if LICENSE_PUBLIC_KEY.is_empty() {
        return Ok(community_license());
    }

    let path = license_path();

    if !path.exists() {
        return Ok(community_license());
    }

    let content = std::fs::read_to_string(&path).map_err(|_| LicenseError::ReadFailed)?;

    let file: LicenseFile =
        serde_json::from_str(&content).map_err(|_| LicenseError::InvalidFormat)?;

    verify_signature(&file)?;

    let today = today_iso();
    if file.valid_until != "unlimited" && file.valid_until < today {
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

fn verify_signature(file: &LicenseFile) -> Result<(), LicenseError> {
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let public_bytes = base64::engine::general_purpose::STANDARD
        .decode(LICENSE_PUBLIC_KEY)
        .map_err(|_| LicenseError::SignatureInvalid)?;

    let public_key = VerifyingKey::from_bytes(
        &public_bytes
            .try_into()
            .map_err(|_| LicenseError::SignatureInvalid)?,
    )
    .map_err(|_| LicenseError::SignatureInvalid)?;

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&file.signature)
        .map_err(|_| LicenseError::SignatureInvalid)?;

    let signature = Signature::from_bytes(
        &sig_bytes
            .try_into()
            .map_err(|_| LicenseError::SignatureInvalid)?,
    );

    let payload = format!(
        "{}|{}|{}|{}|{}",
        file.licensee, file.plan, file.max_users, file.valid_until, file.issued_at,
    );

    public_key
        .verify(payload.as_bytes(), &signature)
        .map_err(|_| LicenseError::SignatureInvalid)
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
    #[error("License signature is invalid")]
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
