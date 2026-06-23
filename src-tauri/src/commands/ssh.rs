// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! SSH Tauri commands.
//!
//! **Security:** The frontend passes only `entry_id` — never raw private key material.
//! Credentials are extracted from the unlocked vault in Rust and zeroized after use.

use tauri::{AppHandle, State};
use vault_core::Vault;
use zeroize::Zeroizing;

use crate::state::AppState;

pub use crate::ssh::SshSessionInfo;

/// Connects to an SSH host using credentials stored in the vault entry.
///
/// IPC input: `entry_id` only. Private keys never cross the Tauri boundary as PEM text.
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
    cols: u32,
    rows: u32,
) -> Result<SshSessionInfo, String> {
    let (host, username, private_key, passphrase) = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        state.record_activity_for(&vault.info());
        let (host, username, private_key, passphrase) = extract_ssh_credentials(&vault, &entry_id)?;
        (
            host,
            username.trim().to_string(),
            Zeroizing::new(private_key),
            passphrase.map(Zeroizing::new),
        )
    };

    state
        .ssh
        .connect(
            app,
            &host,
            &username,
            private_key.as_str(),
            passphrase.as_deref().map(|p| p.as_str()),
            cols,
            rows,
        )
        .await
}

#[tauri::command]
pub fn ssh_begin_streaming(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    state.ssh.begin_streaming(&session_id)
}

#[tauri::command]
pub fn ssh_resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    state.ssh.resize_pty(&session_id, cols, rows)
}

#[tauri::command]
pub fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.touch_activity_if_unlocked();
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
