// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use vault_core::policy::{UserPolicyPreferences, MIN_MASTER_PASSWORD_LEN};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    /// Path to a private SSH key for `git@` remotes (falls back to `~/.ssh/id_ed25519` / `id_rsa`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub https_username: Option<String>,
    /// Stored locally for internal HTTPS remotes; never returned via `get_app_settings` IPC.
    #[serde(default, skip_serializing)]
    pub https_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_vault_path: Option<String>,
    #[serde(default)]
    pub git_sync: GitSyncSettings,
    #[serde(default = "default_force_lock_on_minimize")]
    pub force_lock_on_minimize: bool,
    #[serde(default = "default_auto_lock_seconds")]
    pub auto_lock_seconds: u32,
    /// Persisted hint for browser bridge when vault is locked (no secrets).
    #[serde(default)]
    pub vault_mfa_configured: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            last_vault_path: None,
            git_sync: GitSyncSettings::default(),
            force_lock_on_minimize: default_force_lock_on_minimize(),
            auto_lock_seconds: default_auto_lock_seconds(),
            vault_mfa_configured: false,
        }
    }
}

impl AppSettings {
    pub fn policy_preferences(&self) -> UserPolicyPreferences {
        UserPolicyPreferences {
            force_lock_on_minimize: self.force_lock_on_minimize,
            auto_lock_seconds: self.auto_lock_seconds,
            git_sync_enabled: self.git_sync.enabled,
            min_master_password_len: MIN_MASTER_PASSWORD_LEN as u32,
        }
    }
}

fn default_force_lock_on_minimize() -> bool {
    true
}

fn default_auto_lock_seconds() -> u32 {
    120
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    write_settings(app, settings)
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

/// Persists only the vault file path — never secrets or keys.
pub fn save_last_vault_path(app: &AppHandle, vault_path: &str) -> Result<(), String> {
    let mut settings = load_settings(app).unwrap_or_default();
    settings.last_vault_path = Some(vault_path.to_string());
    write_settings(app, &settings)
}

/// Persists whether the active vault uses MFA — metadata only, for browser bridge hints.
pub fn save_vault_mfa_configured(app: &AppHandle, configured: bool) -> Result<(), String> {
    let mut settings = load_settings(app).unwrap_or_default();
    settings.vault_mfa_configured = configured;
    write_settings(app, &settings)
}

pub fn last_vault_path_if_exists(app: &AppHandle) -> Option<String> {
    let settings = load_settings(app).ok()?;
    let path = settings.last_vault_path?;
    if Path::new(&path).is_file() {
        Some(path)
    } else {
        None
    }
}
