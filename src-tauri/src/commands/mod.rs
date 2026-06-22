// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use tauri::State;
use vault_core::{
    generate_password, PasswordGenOptions, RevealedSecret, SecretEntryInput, SecretEntryPublic,
    SecretEntrySummary, SecretField, VaultInfo,
};
use zeroize::Zeroizing;

use crate::clipboard::SecureClipboard;
use crate::ssh::SshManager;

pub struct AppState {
    pub vault: std::sync::Mutex<vault_core::Vault>,
    pub ssh: SshManager,
    pub clipboard: SecureClipboard,
}

fn wrap_password(password: String) -> Zeroizing<String> {
    Zeroizing::new(password)
}

#[tauri::command]
pub fn health_check() -> String {
    vault_core::health_check().to_string()
}

#[tauri::command]
pub fn get_vault_info(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    Ok(vault.info())
}

#[tauri::command]
pub fn create_vault(
    path: String,
    name: String,
    password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultInfo, String> {
    let password = wrap_password(password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault
        .create(&path, name, &password)
        .map_err(|e| e.to_string())?;
    let info = vault.info();
    bootstrap::remember_vault_path(&app, &info);
    Ok(info)
}

#[tauri::command]
pub fn open_vault(
    path: String,
    password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultInfo, String> {
    let password = wrap_password(password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.open(&path, &password).map_err(|e| e.to_string())?;
    let info = vault.info();
    bootstrap::remember_vault_path(&app, &info);
    Ok(info)
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let password = wrap_password(password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.unlock(&password).map_err(|e| e.to_string())?;
    Ok(vault.info())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    lock_vault_state(state)
}

#[tauri::command]
pub fn list_entries(state: State<'_, AppState>) -> Result<Vec<SecretEntrySummary>, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.list_entries().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_entry(
    input: SecretEntryInput,
    state: State<'_, AppState>,
) -> Result<SecretEntrySummary, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.add_entry(input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_entry(
    id: String,
    input: SecretEntryInput,
    state: State<'_, AppState>,
) -> Result<SecretEntrySummary, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.update_entry(&id, input).map_err(|e| e.to_string())
}

/// Metadata-only entry view — no plaintext secrets over IPC.
#[tauri::command]
pub fn get_entry(id: String, state: State<'_, AppState>) -> Result<SecretEntryPublic, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.get_entry_public(&id).map_err(|e| e.to_string())
}

/// One-shot secret reveal for UI display — frontend must discard value immediately.
#[tauri::command]
pub fn reveal_secret(
    entry_id: String,
    field: Option<SecretField>,
    state: State<'_, AppState>,
) -> Result<RevealedSecret, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault
        .reveal_secret(&entry_id, field.unwrap_or(SecretField::Primary))
        .map_err(|e| e.to_string())
}

/// Copies a secret to the OS clipboard and auto-clears after 30 seconds (Rust-side).
#[tauri::command]
pub fn copy_to_clipboard(
    app: tauri::AppHandle,
    entry_id: String,
    field: Option<SecretField>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let secret = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        let secret = vault
            .extract_secret(&entry_id, field.unwrap_or(SecretField::Primary))
            .map_err(|e| e.to_string())?;
        vault
            .record_audit(vault_core::AuditAction::SecretCopied, Some(&entry_id))
            .map_err(|e| e.to_string())?;
        secret
    };
    state.clipboard.copy(&app, secret)
}

#[tauri::command]
pub fn generate_password_cmd(options: PasswordGenOptions) -> Result<String, String> {
    generate_password(options).map_err(|e| e.to_string())
}

pub mod ssh;

pub mod audit;
pub mod bootstrap;
pub mod compliance;
pub mod diagnostics;
pub mod git_sync;
pub mod open_url;
pub mod policy;
pub mod reachability;

pub mod lock;

pub use lock::perform_lock;

use lock::lock_vault_state;

#[tauri::command]
pub fn ssh_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<crate::ssh::SshSessionInfo, String> {
    ssh::ssh_connect(app, state, entry_id)
}
