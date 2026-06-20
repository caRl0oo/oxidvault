use tauri::{AppHandle, State};
use vault_core::{Vault, VaultInfo};

use crate::commands::AppState;
use crate::settings::{last_vault_path_if_exists, save_last_vault_path};

#[tauri::command]
pub fn bootstrap_vault(app: AppHandle, state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    if vault.info().initialized {
        return Ok(vault.info());
    }

    if let Some(path) = last_vault_path_if_exists(&app) {
        if vault.attach_locked(&path).is_ok() {
            return Ok(vault.info());
        }
    }

    Ok(vault.info())
}

#[tauri::command]
pub fn detach_vault(state: State<'_, AppState>) -> Result<(), String> {
    crate::commands::ssh::disconnect_all_ssh(&state);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    *vault = Vault::new();
    Ok(())
}

pub fn remember_vault_path(app: &AppHandle, info: &VaultInfo) {
    if let Some(path) = &info.path {
        let _ = save_last_vault_path(app, path);
    }
}
