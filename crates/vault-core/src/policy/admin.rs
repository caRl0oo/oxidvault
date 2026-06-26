// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! Central admin policy (GPO-style) loaded from a machine-wide `policy.json`.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::error::VaultError;

use super::password::MIN_MASTER_PASSWORD_LEN;

static ADMIN_POLICY: OnceLock<AdminPolicy> = OnceLock::new();

/// Machine-wide admin policy — fields set here override local user preferences.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_lock_on_minimize: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_lock_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_sync_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_master_password_len: Option<u32>,
}

/// Local user preferences before admin override.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserPolicyPreferences {
    pub force_lock_on_minimize: bool,
    pub auto_lock_seconds: u32,
    pub git_sync_enabled: bool,
    pub min_master_password_len: u32,
}

impl Default for UserPolicyPreferences {
    fn default() -> Self {
        Self {
            force_lock_on_minimize: true,
            auto_lock_seconds: 120,
            git_sync_enabled: false,
            min_master_password_len: MIN_MASTER_PASSWORD_LEN as u32,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedBoolField {
    pub value: bool,
    pub disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedU32Field {
    pub value: u32,
    pub disabled: bool,
}

/// Effective configuration after merging user settings with [`AdminPolicy`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedConfig {
    pub admin_policy_active: bool,
    pub force_lock_on_minimize: ResolvedBoolField,
    pub auto_lock_seconds: ResolvedU32Field,
    pub git_sync_enabled: ResolvedBoolField,
    pub min_master_password_len: ResolvedU32Field,
}

/// Returns the platform-specific admin policy file path.
pub fn admin_policy_path() -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(r"C:\ProgramData\OxidVault\policy.json")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/oxidvault/policy.json")
    }
}

/// Loads `policy.json` when present. Returns `Ok(None)` if the file does not exist.
pub fn load_admin_policy() -> Result<Option<AdminPolicy>, VaultError> {
    let path = admin_policy_path();
    if !path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)?;
    let policy = serde_json::from_str(&raw).map_err(|err| {
        VaultError::Other(format!("invalid admin policy at {}: {err}", path.display()))
    })?;
    Ok(Some(policy))
}

/// Loads admin policy at application startup and caches it for the process lifetime.
pub fn init_admin_policy() -> Result<(), VaultError> {
    let policy = load_admin_policy()?.unwrap_or_default();
    let _ = ADMIN_POLICY.set(policy);
    Ok(())
}

/// Cached admin policy (empty when no `policy.json` was loaded).
pub fn admin_policy() -> &'static AdminPolicy {
    ADMIN_POLICY.get_or_init(AdminPolicy::default)
}

/// Whether a machine-wide `policy.json` file is present.
pub fn admin_policy_active() -> bool {
    admin_policy_path().is_file()
}

/// Merges local user preferences with the cached admin policy.
pub fn resolve_config(user: &UserPolicyPreferences) -> ResolvedConfig {
    resolve_config_with_admin(user, admin_policy())
}

pub fn resolve_config_with_admin(
    user: &UserPolicyPreferences,
    admin: &AdminPolicy,
) -> ResolvedConfig {
    ResolvedConfig {
        admin_policy_active: admin_policy_active(),
        force_lock_on_minimize: merge_bool(
            user.force_lock_on_minimize,
            admin.force_lock_on_minimize,
        ),
        auto_lock_seconds: merge_u32(user.auto_lock_seconds, admin.auto_lock_seconds),
        git_sync_enabled: merge_bool(user.git_sync_enabled, admin.git_sync_enabled),
        min_master_password_len: merge_u32(
            user.min_master_password_len,
            admin.min_master_password_len,
        ),
    }
}

fn merge_bool(user: bool, admin: Option<bool>) -> ResolvedBoolField {
    match admin {
        Some(value) => ResolvedBoolField {
            value,
            disabled: true,
        },
        None => ResolvedBoolField {
            value: user,
            disabled: false,
        },
    }
}

fn merge_u32(user: u32, admin: Option<u32>) -> ResolvedU32Field {
    match admin {
        Some(value) => ResolvedU32Field {
            value,
            disabled: true,
        },
        None => ResolvedU32Field {
            value: user,
            disabled: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_override_locks_ui_fields() {
        let user = UserPolicyPreferences {
            force_lock_on_minimize: false,
            auto_lock_seconds: 120,
            git_sync_enabled: true,
            min_master_password_len: 12,
        };
        let admin = AdminPolicy {
            force_lock_on_minimize: Some(true),
            auto_lock_seconds: None,
            git_sync_enabled: Some(false),
            min_master_password_len: Some(16),
        };

        let resolved = resolve_config_with_admin(&user, &admin);
        assert_eq!(
            resolved.force_lock_on_minimize,
            ResolvedBoolField {
                value: true,
                disabled: true,
            }
        );
        assert_eq!(
            resolved.auto_lock_seconds,
            ResolvedU32Field {
                value: 120,
                disabled: false,
            }
        );
        assert_eq!(
            resolved.git_sync_enabled,
            ResolvedBoolField {
                value: false,
                disabled: true,
            }
        );
        assert_eq!(
            resolved.min_master_password_len,
            ResolvedU32Field {
                value: 16,
                disabled: true,
            }
        );
    }

    #[test]
    fn user_values_without_admin_policy() {
        let user = UserPolicyPreferences::default();
        let resolved = resolve_config_with_admin(&user, &AdminPolicy::default());
        assert!(!resolved.force_lock_on_minimize.disabled);
        assert!(!resolved.auto_lock_seconds.disabled);
        assert!(!resolved.git_sync_enabled.disabled);
    }

    #[test]
    fn admin_policy_path_is_platform_specific() {
        use std::path::Path;
        let path = admin_policy_path();
        #[cfg(windows)]
        assert_eq!(path, Path::new(r"C:\ProgramData\OxidVault\policy.json"));
        #[cfg(not(windows))]
        assert_eq!(path, Path::new("/etc/oxidvault/policy.json"));
    }
}
