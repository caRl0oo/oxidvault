use serde::Serialize;
use tauri::{Emitter, Manager, State, Window, WindowEvent};

use crate::commands::{perform_lock, AppState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultLockedPayload {
    reason: String,
    info: vault_core::VaultInfo,
}

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

    let was_unlocked = state
        .vault
        .lock()
        .map(|v| v.info().initialized && !v.info().locked)
        .unwrap_or(false);

    if !was_unlocked {
        return;
    }

    if let Ok(info) = perform_lock(state) {
        let app = window.app_handle();
        let _ = app.emit(
            "vault-locked",
            VaultLockedPayload {
                reason: "minimize".into(),
                info,
            },
        );
    }
}
