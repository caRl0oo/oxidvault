use tauri::State;
use vault_core::{read_audit_logs, AuditLogEntry, SecurityAuditReport};

use crate::commands::AppState;

#[tauri::command]
pub fn audit_vault_security(state: State<'_, AppState>) -> Result<SecurityAuditReport, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    vault.audit_security().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_audit_logs(state: State<'_, AppState>, limit: usize) -> Result<Vec<AuditLogEntry>, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    let path = vault
        .info()
        .path
        .ok_or_else(|| "Kein Vault geladen".to_string())?;
    read_audit_logs(std::path::Path::new(&path), limit).map_err(|e| e.to_string())
}
