// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::{Emitter, Manager, State, Window, WindowEvent};
use vault_core::policy::admin_policy;

use crate::commands::perform_lock;
use crate::idle_worker::VaultLockedPayload;
use crate::state::AppState;
use crate::system_tray::{self, update_tray_menu};

/// Minimizes the main window to the system tray instead of the taskbar.
pub fn on_main_window_event(window: &Window, event: &WindowEvent, state: &State<'_, AppState>) {
    if window.label() != "main" {
        return;
    }

    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide_to_tray_on_close(window, state);
        }
        WindowEvent::Focused(false) if window.is_minimized().unwrap_or(false) => {
            hide_to_tray_on_minimize(window, state);
        }
        _ => {}
    }
}

fn hide_to_tray_on_close(window: &Window, state: &State<'_, AppState>) {
    let _ = window.hide();

    if should_force_lock_on_minimize() && !state.is_nm_bridge_focusing() {
        lock_for_gpo(window.app_handle(), state);
    }
}

fn hide_to_tray_on_minimize(window: &Window, state: &State<'_, AppState>) {
    let app = window.app_handle();
    let _ = window.hide();
    let _ = window.unminimize();

    if should_force_lock_on_minimize() && !state.is_nm_bridge_focusing() {
        lock_for_gpo(app, state);
    }

    let _ = system_tray::update_tray_menu(app, !state.is_vault_unlocked());
}

fn lock_for_gpo(app: &tauri::AppHandle, state: &State<'_, AppState>) {
    let was_unlocked = state
        .vault
        .lock()
        .map(|v| v.info().initialized && !v.info().locked)
        .unwrap_or(false);

    if !was_unlocked {
        return;
    }

    if let Ok(info) = perform_lock(state) {
        let _ = update_tray_menu(app, true);
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

/// Lock-on-minimize is controlled exclusively by machine-wide `policy.json` (GPO).
fn should_force_lock_on_minimize() -> bool {
    admin_policy().force_lock_on_minimize.unwrap_or(false)
}
