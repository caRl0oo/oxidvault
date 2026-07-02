// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! In-memory bridge token lifecycle (publish on bridge start + each unlock; revoke on app exit only).

use std::sync::Mutex;

use uuid::Uuid;

use crate::nm_bridge::session;

struct BridgeTokenState {
    port: u16,
    token: Mutex<String>,
}

static STATE: Mutex<Option<BridgeTokenState>> = Mutex::new(None);

pub fn init(port: u16) {
    let mut guard = STATE.lock().expect("bridge token state lock poisoned");
    *guard = Some(BridgeTokenState {
        port,
        token: Mutex::new(String::new()),
    });
}

/// Regenerates the session token and writes a protected session file (bridge start + each unlock).
pub fn publish() -> Result<(), String> {
    let guard = STATE
        .lock()
        .map_err(|e| format!("bridge token state lock poisoned: {e}"))?;
    let state = guard
        .as_ref()
        .ok_or_else(|| "bridge not initialized".to_string())?;
    let token = Uuid::new_v4().to_string();
    {
        let mut token_guard = state.token.lock().map_err(|e| e.to_string())?;
        *token_guard = token.clone();
    }
    session::write_session(state.port, &token)
}

/// Clears the in-memory token and deletes the session file (app exit only).
pub fn revoke() {
    if let Ok(mut guard) = STATE.lock() {
        if let Some(state) = guard.as_ref() {
            if let Ok(mut token) = state.token.lock() {
                token.clear();
            }
        }
        *guard = None;
    }
    session::remove_session();
}

pub fn validate(candidate: &str) -> bool {
    let Ok(guard) = STATE.lock() else {
        return false;
    };
    let Some(state) = guard.as_ref() else {
        return false;
    };
    state
        .token
        .lock()
        .ok()
        .is_some_and(|token| !token.is_empty() && token.as_str() == candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_test_session_dir<F: FnOnce()>(f: F) {
        let _env = session::test_env();
        session::remove_session();
        if let Ok(mut guard) = STATE.lock() {
            *guard = None;
        }
        f();
        revoke();
    }

    #[test]
    fn publish_writes_session_file() {
        with_test_session_dir(|| {
            init(40_001);
            publish().expect("publish");
            let info = session::read_session().expect("session");
            assert_eq!(info.port, 40_001);
            assert!(!info.token.is_empty());
            assert!(validate(&info.token));
        });
    }

    #[test]
    fn token_differs_across_two_unlocks() {
        with_test_session_dir(|| {
            init(40_002);
            publish().expect("first publish");
            let first = session::read_session().expect("session").token;
            publish().expect("second publish");
            let second = session::read_session().expect("session").token;
            assert_ne!(first, second);
            assert!(validate(&second));
        });
    }

    #[test]
    fn session_file_survives_lock_without_revoke() {
        with_test_session_dir(|| {
            init(40_003);
            publish().expect("publish");
            let path = session::session_file_path().expect("path");
            assert!(path.is_file());
            // Lock no longer calls revoke — session file must remain for extension polling.
        });
    }

    #[test]
    fn revoke_removes_session_file_on_exit() {
        with_test_session_dir(|| {
            init(40_004);
            publish().expect("publish");
            let path = session::session_file_path().expect("path");
            assert!(path.is_file());
            revoke();
            assert!(!path.is_file());
        });
    }
}
