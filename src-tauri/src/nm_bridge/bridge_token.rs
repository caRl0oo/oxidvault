// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! In-memory bridge token lifecycle (publish on unlock, revoke on lock).

use std::sync::{Mutex, OnceLock};

use uuid::Uuid;

use crate::nm_bridge::session;

struct BridgeTokenState {
    port: u16,
    token: Mutex<String>,
}

static STATE: OnceLock<BridgeTokenState> = OnceLock::new();

pub fn init(port: u16) {
    let _ = STATE.set(BridgeTokenState {
        port,
        token: Mutex::new(String::new()),
    });
    session::remove_session();
}

/// Regenerates the session token and writes a protected session file (call on unlock).
pub fn publish() -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "bridge not initialized".to_string())?;
    let token = Uuid::new_v4().to_string();
    {
        let mut guard = state.token.lock().map_err(|e| e.to_string())?;
        *guard = token.clone();
    }
    session::write_session(state.port, &token)
}

/// Clears the in-memory token and deletes the session file (call on lock / exit).
pub fn revoke() {
    if let Some(state) = STATE.get() {
        if let Ok(mut token) = state.token.lock() {
            token.clear();
        }
    }
    session::remove_session();
}

pub fn validate(candidate: &str) -> bool {
    let Some(state) = STATE.get() else {
        return false;
    };
    state
        .token
        .lock()
        .ok()
        .is_some_and(|token| !token.is_empty() && token.as_str() == candidate)
}
