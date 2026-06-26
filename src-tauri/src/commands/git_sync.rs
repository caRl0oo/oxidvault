// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, State};
use vault_core::policy::resolve_config;

use crate::git::{self, GitSyncAuth, GitSyncResult};
use crate::settings::{load_settings, save_settings, AppSettings, GitSyncSettings};
use zeroize::Zeroizing;

use super::{ensure_vault_unlocked, ensure_vault_unlocked_state, AppState};

fn record_vault_audit<F>(state: &AppState, write: F) -> Result<(), String>
where
    F: FnOnce(&vault_core::Vault) -> Result<(), vault_core::VaultError>,
{
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    write(&vault).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn update_git_sync_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
    remote_url: Option<String>,
    ssh_key_path: Option<String>,
    https_username: Option<String>,
    https_password: Option<String>,
) -> Result<AppSettings, String> {
    ensure_vault_unlocked(&state)?;
    state.touch_activity_if_unlocked();
    let settings = load_settings(&app)?;
    let resolved = resolve_config(&settings.policy_preferences());
    if resolved.git_sync_enabled.disabled && enabled != resolved.git_sync_enabled.value {
        return Err("Git-Synchronisation wird durch die Admin-Richtlinie verwaltet.".into());
    }

    let mut settings = settings;
    let previous_password = settings.git_sync.https_password.clone();
    settings.git_sync = GitSyncSettings {
        enabled: if resolved.git_sync_enabled.disabled {
            resolved.git_sync_enabled.value
        } else {
            enabled
        },
        remote_url: remote_url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty()),
        ssh_key_path: ssh_key_path
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty()),
        https_username: https_username
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty()),
        https_password: https_password
            .map(|secret| secret.to_string())
            .filter(|secret| !secret.is_empty())
            .or(previous_password),
    };
    save_settings(&app, &settings)?;
    record_vault_audit(&state, |vault| vault.record_config_changed("git_sync"))?;
    Ok(settings)
}

/// Runs git pull → commit/push for the open vault directory (blocking git via `spawn_blocking`).
#[tauri::command]
pub async fn trigger_git_sync(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, String> {
    execute_git_sync(&app, &state).await
}

/// Backward-compatible alias for [`trigger_git_sync`].
#[tauri::command]
pub async fn sync_vault_git(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, String> {
    execute_git_sync(&app, &state).await
}

/// Stores the Git SSH key passphrase in the OS keyring (`oxidvault` / `git-ssh-passphrase`).
#[tauri::command]
pub fn save_ssh_passphrase(state: State<'_, AppState>, passphrase: String) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    let secret = Zeroizing::new(passphrase);
    log::info!("[git-sync] save_ssh_passphrase command invoked");
    git::save_ssh_passphrase(secret.as_str())
}

/// Removes the Git SSH key passphrase from the OS keyring.
#[tauri::command]
pub fn remove_ssh_passphrase(state: State<'_, AppState>) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    git::remove_ssh_passphrase()
}

async fn execute_git_sync(app: &AppHandle, state: &AppState) -> Result<GitSyncResult, String> {
    ensure_vault_unlocked_state(state)?;
    state.touch_activity_if_unlocked();
    let settings = load_settings(app)?;
    let resolved = resolve_config(&settings.policy_preferences());
    if !resolved.git_sync_enabled.value {
        return Err("Git-Synchronisation ist deaktiviert.".into());
    }
    let remote_url = settings
        .git_sync
        .remote_url
        .clone()
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| "Kein Remote-Repository konfiguriert.".to_string())?;

    let vault_path = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        vault
            .info()
            .path
            .ok_or_else(|| "Kein Vault geöffnet.".to_string())?
    };

    let vault_path_buf = PathBuf::from(vault_path);
    let auth = GitSyncAuth::from_settings(&settings.git_sync);
    let sync_result = tokio::time::timeout(
        Duration::from_secs(120),
        tokio::task::spawn_blocking(move || git::sync_vault(&vault_path_buf, &remote_url, &auth)),
    )
    .await
    .map_err(|_| {
        "Git-Synchronisation Timeout (120s). Bei großem Repository: Vault in einen eigenen Ordner verschieben.".to_string()
    })?
    .map_err(|e| e.to_string())?;

    match sync_result {
        Ok(result) => {
            record_vault_audit(state, |vault| vault.record_sync_event("success"))?;
            if result.vault_reloaded {
                let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
                if vault.is_unlocked() {
                    vault.reload_from_disk().map_err(|e| e.to_string())?;
                }
            }
            Ok(result)
        }
        Err(err) => {
            let _ = record_vault_audit(state, |vault| vault.record_sync_event("failed"));
            Err(err.message)
        }
    }
}
