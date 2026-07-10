// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::State;
use vault_core::{
    generate_password, PasswordGenOptions, RevealedSecret, SecretEntryInput, SecretEntryPublic,
    SecretEntrySummary, SecretField, UnlockStep, UnlockVaultResponse, VaultError, VaultInfo,
};
use zeroize::Zeroizing;

use crate::settings;

pub use crate::state::AppState;

mod vault_guard;
pub use vault_guard::{ensure_vault_unlocked, ensure_vault_unlocked_state};

pub(super) fn note_unlock_error(state: &AppState, err: &VaultError) {
    if matches!(err, VaultError::InvalidMfaCode) {
        if let Ok(mut bridge) = state.bridge.lock() {
            bridge.note_mfa_failed();
        }
    }
}

pub(super) fn note_unlock_success(
    state: &AppState,
    app: &tauri::AppHandle,
    vault: &vault_core::Vault,
) {
    if let Ok(mut bridge) = state.bridge.lock() {
        bridge.clear_mfa_failed();
    }
    if let Err(err) = crate::nm_bridge::publish_bridge_session() {
        eprintln!("native messaging bridge: failed to publish session: {err}");
    }
    state.touch_activity();
    let _ = settings::save_vault_mfa_configured(app, vault.mfa_status().mfa_enabled);
    crate::nm_bridge::emit_new_secret_prefill_if_pending(app);
    crate::system_tray::notify_vault_unlocked(app);
}

pub(super) fn wrap_password(password: String) -> Zeroizing<String> {
    Zeroizing::new(password)
}

pub(super) fn unlock_response(vault: &vault_core::Vault, step: UnlockStep) -> UnlockVaultResponse {
    match step {
        UnlockStep::Complete => {
            let username = vault
                .get_current_user_public()
                .map(|user| user.username)
                .unwrap_or_default();
            UnlockVaultResponse::complete_as_user(vault.info(), username)
        }
        UnlockStep::MfaRequired => UnlockVaultResponse::mfa_pending(vault.info()),
    }
}

pub(super) fn sync_vault_format_state(state: &AppState, vault: &vault_core::Vault) {
    if let Ok(mut version) = state.vault_format_version.lock() {
        *version = vault.format_version() as u8;
    }
}

#[tauri::command]
pub fn health_check() -> String {
    vault_core::health_check().to_string()
}

#[tauri::command]
pub fn get_vault_info(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    Ok(vault.info())
}

#[tauri::command]
pub fn touch_activity(state: State<'_, AppState>) {
    state.touch_activity_if_unlocked();
}

#[tauri::command]
pub fn open_vault(
    path: String,
    _password: String,
    _mfa_code: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<UnlockVaultResponse, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.attach_locked(&path).map_err(|e| e.to_string())?;
    sync_vault_format_state(&state, &vault);
    let response = UnlockVaultResponse::multi_user_pending(vault.info());
    if response.vault.initialized {
        bootstrap::remember_vault_path(&app, &response.vault);
    }
    Ok(response)
}

#[tauri::command]
pub fn unlock_vault(state: State<'_, AppState>) -> Result<UnlockVaultResponse, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    Ok(UnlockVaultResponse::multi_user_pending(vault.info()))
}

#[tauri::command]
pub fn lock_vault(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<VaultInfo, String> {
    let info = lock_vault_state(state)?;
    crate::system_tray::notify_vault_locked(&app, &info);
    Ok(info)
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    perform_lock(&state)?;
    crate::nm_bridge::revoke_bridge_session();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn list_entries(state: State<'_, AppState>) -> Result<Vec<SecretEntrySummary>, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.list_entries().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_entry(
    input: SecretEntryInput,
    state: State<'_, AppState>,
) -> Result<SecretEntrySummary, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.add_entry(input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_entry(
    id: String,
    input: SecretEntryInput,
    state: State<'_, AppState>,
) -> Result<SecretEntrySummary, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.update_entry(&id, input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_entry(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.delete_entry(&id).map_err(|e| e.to_string())
}

/// Metadata-only entry view — no plaintext secrets over IPC.
#[tauri::command]
pub fn get_entry(id: String, state: State<'_, AppState>) -> Result<SecretEntryPublic, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
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
    state.record_activity_for(&vault.info());
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
        state.record_activity_for(&vault.info());
        let secret = vault
            .extract_secret(&entry_id, field.unwrap_or(SecretField::Primary))
            .map_err(|e| e.to_string())?;
        vault
            .record_secret_copied(&entry_id)
            .map_err(|e| e.to_string())?;
        secret
    };
    state.clipboard.copy(&app, secret)
}

/// Reads the current OS clipboard text (no auto-clear timer involved).
///
/// Returns an empty string if the clipboard does not contain text.
#[tauri::command]
pub fn read_clipboard_text(state: State<'_, AppState>) -> Result<String, String> {
    ensure_vault_unlocked(&state)?;

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(arboard::Error::ContentNotAvailable) => Ok(String::new()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn generate_password_cmd(options: PasswordGenOptions) -> Result<String, String> {
    generate_password(options).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn enable_mfa(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<vault_core::MfaSetupInfo, String> {
    ensure_vault_unlocked(&state)?;
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    let info = vault
        .enable_mfa_for_current_user()
        .map_err(|e| e.to_string())?;
    let _ = settings::save_vault_mfa_configured(&app, true);
    Ok(info)
}

#[tauri::command]
pub fn get_mfa_status(state: State<'_, AppState>) -> Result<vault_core::MfaStatus, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    Ok(vault.mfa_status())
}

#[tauri::command]
pub fn take_extension_new_secret(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.touch_activity_if_unlocked();
    let mut bridge = state.bridge.lock().map_err(|e| e.to_string())?;
    Ok(bridge
        .take_pending_new_secret()
        .map(|password| password.to_string()))
}

#[tauri::command]
pub fn disable_mfa(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .disable_mfa_for_current_user()
        .map_err(|e| e.to_string())?;
    let _ = settings::save_vault_mfa_configured(&app, false);
    Ok(())
}

#[tauri::command]
pub fn verify_mfa_code(code: String, state: State<'_, AppState>) -> Result<bool, String> {
    let code = Zeroizing::new(code);
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    let verified = vault
        .verify_mfa_code_for_current_user(code.as_str())
        .map_err(|e| e.to_string())?;
    Ok(verified)
}

pub mod ssh;
pub mod users;

pub mod audit;
pub mod bootstrap;
pub mod compliance;
pub mod diagnostics;
pub mod file_dialog;
pub mod git_sync;
pub mod open_url;
pub mod policy;
pub mod reachability;

pub mod lock;

pub use lock::perform_lock;

use lock::lock_vault_state;

#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
    cols: u32,
    rows: u32,
) -> Result<crate::ssh::SshConnectResponse, String> {
    ssh::ssh_connect(app, state, entry_id, cols, rows).await
}
