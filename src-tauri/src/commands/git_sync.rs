use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::git_sync::{self, GitSyncResult};
use crate::settings::{load_settings, save_settings, AppSettings, GitSyncSettings};

use super::AppState;

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn update_git_sync_settings(
    app: AppHandle,
    enabled: bool,
    remote_url: Option<String>,
) -> Result<AppSettings, String> {
    let mut settings = load_settings(&app)?;
    settings.git_sync = GitSyncSettings {
        enabled,
        remote_url: remote_url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty()),
    };
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn sync_vault_git(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, String> {
    let settings = load_settings(&app)?;
    if !settings.git_sync.enabled {
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
    let result = tokio::task::spawn_blocking(move || {
        git_sync::sync_vault(&vault_path_buf, &remote_url)
    })
    .await
    .map_err(|e| e.to_string())??;

    if result.vault_reloaded {
        let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
        vault.reload_from_disk().map_err(|e| e.to_string())?;
    }

    Ok(result)
}
