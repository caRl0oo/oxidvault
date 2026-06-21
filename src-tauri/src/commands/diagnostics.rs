use tauri::{AppHandle, State};
use vault_core::SystemDiagnostics;

use crate::commands::AppState;
use crate::settings::load_settings;

#[tauri::command]
pub fn get_system_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SystemDiagnostics, String> {
    let loaded_path = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        vault.info().path
    };

    let stored_path = load_settings(&app)
        .ok()
        .and_then(|settings| settings.last_vault_path);

    Ok(vault_core::collect_system_diagnostics(
        loaded_path.as_deref(),
        stored_path.as_deref(),
    ))
}
