// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::PathBuf;

use tauri::{AppHandle, State};
use vault_core::policy::resolve_config;

use crate::git_sync::{self, GitSyncResult};
use crate::settings::{load_settings, save_settings, AppSettings, GitSyncSettings};

use super::AppState;

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
) -> Result<AppSettings, String> {
    let settings = load_settings(&app)?;
    let resolved = resolve_config(&settings.policy_preferences());
    if resolved.git_sync_enabled.disabled && enabled != resolved.git_sync_enabled.value {
        return Err("Git-Synchronisation wird durch die Admin-Richtlinie verwaltet.".into());
    }

    let mut settings = settings;
    settings.git_sync = GitSyncSettings {
        enabled: if resolved.git_sync_enabled.disabled {
            resolved.git_sync_enabled.value
        } else {
            enabled
        },
        remote_url: remote_url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty()),
    };
    save_settings(&app, &settings)?;
    record_vault_audit(&state, |vault| vault.record_config_changed("git_sync"))?;
    Ok(settings)
}

#[tauri::command]
pub async fn sync_vault_git(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, String> {
    let settings = load_settings(&app)?;
    let resolved = resolve_config(&settings.policy_preferences());
    if !resolved.git_sync_enabled.value {
        return Err("Git-Synchronisation ist deaktiviert.".into());
    }
    let remote_url = settings
        .git_sync
        .remote_url
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
    let sync_result =
        tokio::task::spawn_blocking(move || git_sync::sync_vault(&vault_path_buf, &remote_url))
            .await
            .map_err(|e| e.to_string())?;

    match sync_result {
        Ok(result) => {
            record_vault_audit(&state, |vault| vault.record_sync_event("success"))?;
            if result.vault_reloaded {
                let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
                vault.reload_from_disk().map_err(|e| e.to_string())?;
            }
            Ok(result)
        }
        Err(err) => {
            let _ = record_vault_audit(&state, |vault| vault.record_sync_event("failed"));
            Err(err)
        }
    }
}
