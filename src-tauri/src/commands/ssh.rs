// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! SSH Tauri commands.
//!
//! **Security:** The frontend passes only `entry_id` — never raw private key material.
//! Credentials are extracted from the unlocked vault in Rust and zeroized after use.

use tauri::{AppHandle, State};
use vault_core::{SshConnectCredentials, Vault};
use zeroize::Zeroizing;

use super::ensure_vault_unlocked;
use crate::ssh::{SshConnectResponse, SshSessionInfo};
use crate::state::AppState;

/// Connects to an SSH host using credentials stored in the vault entry.
///
/// IPC input: `entry_id` only. Private keys never cross the Tauri boundary as PEM text.
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
    cols: u32,
    rows: u32,
) -> Result<SshConnectResponse, String> {
    let (host, username, private_key, passphrase, known_host_fingerprint) = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        state.record_activity_for(&vault.info());
        let (host, username, private_key, passphrase, known_host_fingerprint) =
            extract_ssh_credentials(&vault, &entry_id)?;
        (
            host,
            username.trim().to_string(),
            Zeroizing::new(private_key),
            passphrase.map(Zeroizing::new),
            known_host_fingerprint,
        )
    };

    state
        .ssh
        .connect(
            app,
            &entry_id,
            &host,
            &username,
            private_key.as_str(),
            passphrase.as_deref().map(|p| p.as_str()),
            known_host_fingerprint.as_deref(),
            cols,
            rows,
        )
        .await
}

/// Trusts the observed host key, persists the fingerprint, and activates the pending session.
#[tauri::command]
pub fn ssh_trust_host(
    state: State<'_, AppState>,
    entry_id: String,
    session_id: String,
    fingerprint: String,
) -> Result<SshSessionInfo, String> {
    ensure_vault_unlocked(&state)?;
    let fp = fingerprint.trim();
    if fp.is_empty() {
        return Err("host key fingerprint is empty".into());
    }

    let session = state
        .ssh
        .promote_pending_session(&session_id, &entry_id, fp)?;

    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .update_entry_fingerprint(&entry_id, fp)
        .map_err(|e| e.to_string())?;

    Ok(session)
}

#[tauri::command]
pub fn ssh_clear_host_fingerprint(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .clear_ssh_known_host_fingerprint(&entry_id)
        .map_err(|e| e.to_string())
}

/// Rejects an unknown host key and tears down the pending SSH session.
#[tauri::command]
pub fn ssh_reject_host(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.ssh.reject_pending_session(&session_id)
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

fn extract_ssh_credentials(vault: &Vault, entry_id: &str) -> Result<SshConnectCredentials, String> {
    vault
        .extract_ssh_credentials(entry_id)
        .map_err(|e| e.to_string())
}

pub fn disconnect_all_ssh(state: &AppState) {
    state.ssh.disconnect_all();
}
