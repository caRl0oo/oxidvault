use tauri::State;
use vault_core::VaultInfo;

use crate::commands::AppState;

/// Locks the vault (RAM purge + SSH disconnect). No-op if already locked.
pub fn perform_lock(state: &AppState) -> Result<VaultInfo, String> {
    crate::commands::ssh::disconnect_all_ssh(state);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    if vault.info().locked {
        return Ok(vault.info());
    }
    vault.lock();
    Ok(vault.info())
}

pub fn lock_vault_state(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    perform_lock(&state)
}
