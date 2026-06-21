use tauri::{AppHandle, State};
use vault_core::Vault;

use crate::commands::AppState;

pub use crate::ssh::SshSessionInfo;

pub fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<SshSessionInfo, String> {
    let (host, username, private_key, passphrase) = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        extract_ssh_credentials(&vault, &entry_id)?
    };

    state
        .ssh
        .connect(app, &host, &username, &private_key, passphrase.as_deref())
}

#[tauri::command]
pub fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.ssh.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.ssh.disconnect(&session_id);
    Ok(())
}

fn extract_ssh_credentials(
    vault: &Vault,
    entry_id: &str,
) -> Result<(String, String, String, Option<String>), String> {
    vault
        .extract_ssh_credentials(entry_id)
        .map_err(|e| e.to_string())
}

pub fn disconnect_all_ssh(state: &AppState) {
    state.ssh.disconnect_all();
}
