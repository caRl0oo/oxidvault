use tauri::State;
use vault_core::ComplianceStatus;
use zeroize::Zeroizing;

use crate::commands::AppState;

#[tauri::command]
pub fn get_compliance_status(state: State<'_, AppState>) -> Result<ComplianceStatus, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.compliance_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reencrypt_vault(
    current_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let current = Zeroizing::new(current_password);
    let new_password = Zeroizing::new(new_password);
    let mut vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault
        .reencrypt_vault(current.as_str(), new_password.as_str())
        .map_err(|e| e.to_string())
}
