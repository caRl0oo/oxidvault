// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};
use vault_core::{Plan, UnlockStep, UnlockVaultResponse, UserRole, VaultUserPublic, CE_MAX_USERS};

use super::bootstrap;
use super::vault_guard::ensure_vault_unlocked;
use super::{
    note_unlock_error, note_unlock_success, sync_vault_format_state, unlock_response,
    wrap_password, AppState,
};

fn parse_user_role(role: &str) -> Result<UserRole, String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "admin" => Ok(UserRole::Admin),
        "member" => Ok(UserRole::Member),
        _ => Err("invalid role".into()),
    }
}

fn ensure_multi_user(state: &AppState) -> Result<(), String> {
    if !state.is_multi_user() {
        return Err("not a multi-user vault".into());
    }
    Ok(())
}

/// Attaches a vault file in locked state (for open flow / user list before unlock).
#[tauri::command]
pub fn attach_vault_path(
    path: String,
    state: State<'_, AppState>,
) -> Result<vault_core::VaultInfo, String> {
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.attach_locked(&path).map_err(|e| e.to_string())?;
    sync_vault_format_state(&state, &vault);
    Ok(vault.info())
}

/// Creates a new v3 vault with the first admin user.
#[tauri::command]
pub fn create_vault_v3(
    path: String,
    vault_name: String,
    admin_username: String,
    admin_password: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<vault_core::VaultInfo, String> {
    let admin_password = wrap_password(admin_password);
    let vault = vault_core::Vault::create_v3(
        Path::new(&path),
        &vault_name,
        &admin_username,
        admin_password,
    )
    .map_err(|e| e.to_string())?;

    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = vault;
    sync_vault_format_state(&state, &guard);
    let info = guard.info();
    bootstrap::remember_vault_path(&app, &info);
    state.touch_activity();
    Ok(info)
}

/// Unlocks a v3 vault as a specific user.
#[tauri::command]
pub fn unlock_vault_as_user(
    username: String,
    password: String,
    mfa_code: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UnlockVaultResponse, String> {
    ensure_multi_user(&state)?;
    let password = wrap_password(password);
    let mfa_code = mfa_code.map(wrap_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;

    let step = match vault.unlock_as_user(
        &username,
        password,
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
    sync_vault_format_state(&state, &vault);
    Ok(unlock_response(&vault, step))
}

/// Lists vault users (IPC-safe). Works on locked v3 vaults — user list is in the plaintext header.
#[tauri::command]
pub fn list_vault_users(state: State<'_, AppState>) -> Result<Vec<VaultUserPublic>, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    if !vault.info().initialized {
        return Err(vault_core::VaultError::NoVaultFile.to_string());
    }
    Ok(vault.list_users())
}

/// Adds a new user (Admin only).
#[tauri::command]
pub fn add_vault_user(
    new_username: String,
    new_password: String,
    role: String,
    state: State<'_, AppState>,
) -> Result<VaultUserPublic, String> {
    ensure_vault_unlocked(&state)?;
    ensure_multi_user(&state)?;

    {
        let license = state
            .license
            .lock()
            .map_err(|_| "Internal error".to_string())?;
        let vault = state
            .vault
            .lock()
            .map_err(|_| "Internal error".to_string())?;
        let current_count = vault.list_users().len();
        if !license.can_add_user(current_count) {
            return Err("license_limit_exceeded".to_string());
        }
    }

    let new_password = wrap_password(new_password);
    let role = parse_user_role(&role)?;
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .add_user(&new_username, new_password, role)
        .map_err(|e| e.to_string())?;
    vault
        .list_users()
        .into_iter()
        .find(|user| user.username == new_username)
        .ok_or_else(|| "user not found after add".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseInfo {
    pub plan: String,
    pub licensee: String,
    pub max_users: usize,
    pub valid_until: String,
    pub ce_max_users: usize,
}

/// Returns the active license (independent of vault lock state).
#[tauri::command]
pub fn get_license_info(state: State<'_, AppState>) -> Result<LicenseInfo, String> {
    let license = state
        .license
        .lock()
        .map_err(|_| "Internal error".to_string())?;

    Ok(LicenseInfo {
        plan: match license.plan {
            Plan::Community => "community".to_string(),
            Plan::Enterprise => "enterprise".to_string(),
        },
        licensee: license.licensee.clone(),
        max_users: license.max_users,
        valid_until: license.valid_until.clone(),
        ce_max_users: CE_MAX_USERS,
    })
}

/// Removes a user (Admin only; cannot remove self).
#[tauri::command]
pub fn remove_vault_user(username: String, state: State<'_, AppState>) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    ensure_multi_user(&state)?;
    if state.current_username().as_deref() == Some(username.trim()) {
        return Err("insufficient permissions".into());
    }
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.remove_user(&username).map_err(|e| e.to_string())
}

/// Changes the current user's password (v3 only).
#[tauri::command]
pub fn change_user_password(
    current_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    ensure_vault_unlocked(&state)?;
    ensure_multi_user(&state)?;
    let current_password = wrap_password(current_password);
    let new_password = wrap_password(new_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .change_own_password(current_password, new_password)
        .map_err(|e| e.to_string())
}

/// Migrates a v1/v2 vault to v3 multi-user format.
#[tauri::command]
pub fn migrate_vault_to_v3(
    current_password: String,
    admin_username: String,
    state: State<'_, AppState>,
) -> Result<vault_core::VaultInfo, String> {
    ensure_vault_unlocked(&state)?;
    if state.is_multi_user() {
        return Err("vault is already multi-user".into());
    }
    let current_password = wrap_password(current_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault
        .migrate_to_v3(current_password, &admin_username)
        .map_err(|e| e.to_string())?;
    sync_vault_format_state(&state, &vault);
    Ok(vault.info())
}

/// Returns the currently logged-in user (v3 only).
#[tauri::command]
pub fn get_current_user(state: State<'_, AppState>) -> Result<Option<VaultUserPublic>, String> {
    ensure_vault_unlocked(&state)?;
    if !state.is_multi_user() {
        return Ok(None);
    }
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    Ok(vault.get_current_user_public())
}
