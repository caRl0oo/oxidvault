// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::{Emitter, Manager, State, Window, WindowEvent};
use vault_core::policy::{resolve_config, UserPolicyPreferences};

use crate::commands::perform_lock;
use crate::idle_worker::VaultLockedPayload;
use crate::settings::load_settings;
use crate::state::AppState;

/// Locks the vault when the main window is minimized (Focus loss + is_minimized).
pub fn on_main_window_event(window: &Window, event: &WindowEvent, state: &State<'_, AppState>) {
    if window.label() != "main" {
        return;
    }

    let should_lock = match event {
        WindowEvent::Focused(false) => window.is_minimized().unwrap_or(false),
        _ => false,
    };

    if !should_lock {
        return;
    }

    let app = window.app_handle();
    let resolved = load_settings(app)
        .map(|settings| resolve_config(&settings.policy_preferences()))
        .unwrap_or_else(|_| resolve_config(&UserPolicyPreferences::default()));

    if !resolved.force_lock_on_minimize.value {
        return;
    }

    if state.is_nm_bridge_focusing() {
        return;
    }

    let was_unlocked = state
        .vault
        .lock()
        .map(|v| v.info().initialized && !v.info().locked)
        .unwrap_or(false);

    if !was_unlocked {
        return;
    }

    if let Ok(info) = perform_lock(state) {
        let _ = app.emit(
            "vault-locked",
            VaultLockedPayload {
                reason: "minimize".into(),
                info,
                auto_lock_seconds: None,
            },
        );
    }
}
