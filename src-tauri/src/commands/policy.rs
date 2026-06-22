// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use tauri::AppHandle;
use vault_core::policy::{resolve_config, ResolvedConfig};

use crate::settings::load_settings;

#[tauri::command]
pub fn get_resolved_config(app: AppHandle) -> Result<ResolvedConfig, String> {
    let settings = load_settings(&app)?;
    Ok(resolve_config(&settings.policy_preferences()))
}
