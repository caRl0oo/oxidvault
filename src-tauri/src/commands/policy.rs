// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::AppHandle;
use vault_core::policy::{resolve_config, ResolvedConfig};

use crate::settings::load_settings;

#[tauri::command]
pub fn get_resolved_config(app: AppHandle) -> Result<ResolvedConfig, String> {
    let settings = load_settings(&app)?;
    Ok(resolve_config(&settings.policy_preferences()))
}
