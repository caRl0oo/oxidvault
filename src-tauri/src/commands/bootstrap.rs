// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::{AppHandle, State};
use vault_core::{Vault, VaultInfo};

use crate::settings::{last_vault_path_if_exists, save_last_vault_path};
use crate::state::AppState;

#[tauri::command]
pub fn bootstrap_vault(app: AppHandle, state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    if vault.info().initialized {
        return Ok(vault.info());
    }

    if let Some(path) = last_vault_path_if_exists(&app) {
        if vault.attach_locked(&path).is_ok() {
            crate::commands::sync_vault_format_state(&state, &vault);
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
    if let Ok(mut version) = state.vault_format_version.lock() {
        *version = 0;
    }
    Ok(())
}

pub fn remember_vault_path(app: &AppHandle, info: &VaultInfo) {
    if let Some(path) = &info.path {
        let _ = save_last_vault_path(app, path);
    }
}
