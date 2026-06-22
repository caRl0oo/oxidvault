// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use tauri::State;
use vault_core::{
    generate_password, PasswordGenOptions, RevealedSecret, SecretEntryInput, SecretEntryPublic,
    SecretEntrySummary, SecretField, UnlockStep, UnlockVaultResponse, VaultError, VaultInfo,
};
use zeroize::Zeroizing;

use crate::clipboard::SecureClipboard;
use crate::nm_bridge::BridgeAuthState;
use crate::settings;
use crate::ssh::SshManager;

pub struct AppState {
    pub vault: std::sync::Mutex<vault_core::Vault>,
    pub ssh: SshManager,
    pub clipboard: SecureClipboard,
    pub bridge: std::sync::Mutex<BridgeAuthState>,
}

fn note_unlock_error(state: &AppState, err: &VaultError) {
    if matches!(err, VaultError::InvalidMfaCode) {
        if let Ok(mut bridge) = state.bridge.lock() {
            bridge.note_mfa_failed();
        }
    }
}

fn note_unlock_success(state: &AppState, app: &tauri::AppHandle, vault: &vault_core::Vault) {
    if let Ok(mut bridge) = state.bridge.lock() {
        bridge.clear_mfa_failed();
    }
    let _ = settings::save_vault_mfa_configured(app, vault.mfa_status().mfa_enabled);
    crate::nm_bridge::emit_new_secret_prefill_if_pending(app);
}

fn wrap_password(password: String) -> Zeroizing<String> {
    Zeroizing::new(password)
}

fn unlock_response(vault: &vault_core::Vault, step: UnlockStep) -> UnlockVaultResponse {
    match step {
        UnlockStep::Complete => UnlockVaultResponse::complete(vault.info()),
        UnlockStep::MfaRequired => UnlockVaultResponse::mfa_pending(vault.info()),
    }
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
    mfa_code: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UnlockVaultResponse, String> {
    let password = wrap_password(password);
    let mfa_code = mfa_code.map(wrap_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    let step = match vault.open(
        &path,
        &password,
        mfa_code.as_ref().map(|code| code.as_str()),
    ) {
        Ok(step) => step,
        Err(err) => {
            note_unlock_error(&state, &err);
            return Err(err.to_string());
        }
    };
    if step == UnlockStep::Complete {
        note_unlock_success(&state, &app, &vault);
    }
    let response = unlock_response(&vault, step);
    if response.vault.initialized {
        bootstrap::remember_vault_path(&app, &response.vault);
    }
    Ok(response)
}

#[tauri::command]
pub fn unlock_vault(
    password: String,
    mfa_code: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UnlockVaultResponse, String> {
    let password = wrap_password(password);
    let mfa_code = mfa_code.map(wrap_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    let step = match vault.unlock(&password, mfa_code.as_ref().map(|code| code.as_str())) {
        Ok(step) => step,
        Err(err) => {
            note_unlock_error(&state, &err);
            return Err(err.to_string());
        }
    };
    if step == UnlockStep::Complete {
        note_unlock_success(&state, &app, &vault);
    }
    Ok(unlock_response(&vault, step))
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
pub fn delete_entry(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.delete_entry(&id).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn enable_mfa(state: State<'_, AppState>) -> Result<vault_core::MfaSetupInfo, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.begin_mfa_enrollment().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_mfa_status(state: State<'_, AppState>) -> Result<vault_core::MfaStatus, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    Ok(vault.mfa_status())
}

#[tauri::command]
pub fn take_extension_new_secret(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut bridge = state.bridge.lock().map_err(|e| e.to_string())?;
    Ok(bridge
        .take_pending_new_secret()
        .map(|password| password.to_string()))
}

#[tauri::command]
pub fn disable_mfa(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.disable_mfa().map_err(|e| e.to_string())?;
    let _ = settings::save_vault_mfa_configured(&app, false);
    Ok(())
}

#[tauri::command]
pub fn verify_mfa_code(
    code: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let code = Zeroizing::new(code);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    let verified = vault
        .verify_mfa_code(code.as_str())
        .map_err(|e| e.to_string())?;
    if verified {
        let _ = settings::save_vault_mfa_configured(&app, true);
    }
    Ok(verified)
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
