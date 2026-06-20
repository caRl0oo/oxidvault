use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_vault_path: Option<String>,
    #[serde(default)]
    pub git_sync: GitSyncSettings,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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

pub fn last_vault_path_if_exists(app: &AppHandle) -> Option<String> {
    let settings = load_settings(app).ok()?;
    let path = settings.last_vault_path?;
    if Path::new(&path).is_file() {
        Some(path)
    } else {
        None
    }
}
