// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use tauri::{AppHandle, Manager};

use crate::state::AppState;

struct NmBridgeFocusGuard<'a> {
    state: Option<&'a AppState>,
}

impl<'a> NmBridgeFocusGuard<'a> {
    fn new(state: Option<&'a AppState>) -> Self {
        if let Some(state) = state {
            if let Ok(mut guard) = state.nm_bridge_focusing.lock() {
                *guard = true;
            }
        }
        Self { state }
    }
}

impl Drop for NmBridgeFocusGuard<'_> {
    fn drop(&mut self) {
        if let Some(state) = self.state {
            if let Ok(mut guard) = state.nm_bridge_focusing.lock() {
                *guard = false;
            }
        }
    }
}

pub fn main_window_minimized(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|window| window.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// Brings the desktop UI to the foreground (e.g. new-secret prefill).
pub fn focus_main_window(app: &AppHandle, state: Option<&AppState>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let _guard = NmBridgeFocusGuard::new(state);

    let _ = window.unminimize();
    let _ = window.show();
    if !window.is_minimized().unwrap_or(false) {
        let _ = window.set_focus();
    }
}

/// Focuses the unlock UI only when the window is not minimized — avoids lock/focus loops.
pub fn focus_main_window_for_unlock(app: &AppHandle, state: &AppState) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let _guard = NmBridgeFocusGuard::new(Some(state));

    let _ = window.show();
    if !window.is_minimized().unwrap_or(false) {
        let _ = window.set_focus();
    }
}
