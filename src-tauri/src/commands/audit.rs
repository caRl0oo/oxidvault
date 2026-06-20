use tauri::State;
use vault_core::SecurityAuditReport;

use crate::commands::AppState;

#[tauri::command]
pub fn audit_vault_security(state: State<'_, AppState>) -> Result<SecurityAuditReport, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.audit_security().map_err(|e| e.to_string())
}
