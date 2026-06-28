// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::State;
use vault_core::{
    export_audit_report, read_audit_logs, AuditLogEntry, ExportFormat, SecurityAuditReport,
};

use crate::state::AppState;

#[tauri::command]
pub fn audit_vault_security(state: State<'_, AppState>) -> Result<SecurityAuditReport, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    vault.audit_security().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_audit_logs(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<AuditLogEntry>, String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    let path = vault
        .info()
        .path
        .ok_or_else(|| "Kein Vault geladen".to_string())?;
    read_audit_logs(std::path::Path::new(&path), limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_audit_log(
    state: State<'_, AppState>,
    target_path: String,
    format: String,
) -> Result<(), String> {
    let vault = state.vault.lock().map_err(|e| e.to_string())?;
    state.record_activity_for(&vault.info());
    let vault_path = vault
        .info()
        .path
        .ok_or_else(|| "Kein Vault geladen".to_string())?;
    let export_format = ExportFormat::parse(&format).map_err(|e| e.to_string())?;
    export_audit_report(
        std::path::PathBuf::from(vault_path),
        std::path::PathBuf::from(target_path),
        export_format,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
