use tauri::State;
use vault_core::{
    generate_password, PasswordGenOptions, SecretEntry, SecretEntryInput, SecretEntrySummary,
    Vault, VaultInfo,
};

use crate::ssh::SshManager;

pub struct AppState {
    pub vault: std::sync::Mutex<Vault>,
    pub ssh: SshManager,
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
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.open(&path, &password).map_err(|e| e.to_string())?;
    let info = vault.info();
    bootstrap::remember_vault_path(&app, &info);
    Ok(info)
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, AppState>) -> Result<VaultInfo, String> {
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

#[tauri::command]
pub fn get_entry(id: String, state: State<'_, AppState>) -> Result<SecretEntry, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.get_entry(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_password_cmd(options: PasswordGenOptions) -> Result<String, String> {
    generate_password(options).map_err(|e| e.to_string())
}

pub mod ssh;

pub mod audit;
pub mod bootstrap;
pub mod git_sync;
pub mod open_url;
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
