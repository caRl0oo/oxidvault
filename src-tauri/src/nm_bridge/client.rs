// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::nm_bridge::focus::{
    focus_main_window, focus_main_window_for_unlock, main_window_minimized,
};
use crate::nm_bridge::framing::{read_message, write_message};
use crate::nm_bridge::protocol::{BridgeRequest, BridgeResponse};
use crate::nm_bridge::session;
use crate::settings;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(5);

fn forward_bridge_request(
    action: &str,
    url: Option<&str>,
    password: Option<&str>,
) -> BridgeResponse {
    let Some(session) = session::read_session() else {
        return BridgeResponse::unavailable();
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], session.port));
    let mut stream = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => return BridgeResponse::unavailable(),
    };

    if stream.set_read_timeout(Some(IO_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(IO_TIMEOUT)).is_err()
    {
        return BridgeResponse::error("ipc timeout configuration failed");
    }

    let request = BridgeRequest {
        action: action.into(),
        url: url.map(str::to_string),
        password: password.map(str::to_string),
        token: session.token,
    };

    let payload = match serde_json::to_vec(&request) {
        Ok(bytes) => bytes,
        Err(e) => return BridgeResponse::error(format!("request serialization failed: {e}")),
    };

    if write_message(&mut stream, &payload).is_err() {
        return BridgeResponse::unavailable();
    }

    let response_bytes = match read_message(&mut stream) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return BridgeResponse::error("empty ipc response"),
        Err(e) => return BridgeResponse::error(format!("ipc read failed: {e}")),
    };

    match serde_json::from_slice::<BridgeResponse>(&response_bytes) {
        Ok(response) => response,
        Err(e) => BridgeResponse::error(format!("invalid ipc response: {e}")),
    }
}

/// Forwards a `get_login` request to the desktop app's localhost bridge.
pub fn request_get_login(page_hostname: &str) -> BridgeResponse {
    forward_bridge_request("get_login", Some(page_hostname), None)
}

/// Forwards a `vault_status` request to the desktop app's localhost bridge.
pub fn request_vault_status() -> BridgeResponse {
    forward_bridge_request("vault_status", None, None)
}

/// Forwards a `request_unlock` action to focus the desktop unlock UI.
pub fn request_unlock() -> BridgeResponse {
    forward_bridge_request("request_unlock", None, None)
}

/// Opens the desktop new-secret dialog with a one-shot generated password prefill.
pub fn request_open_new_secret(password: &str) -> BridgeResponse {
    forward_bridge_request("open_new_secret", None, Some(password))
}

/// Actions allowed while the vault is locked (no secret-bearing IPC).
pub(crate) fn is_locked_permitted_action(action: &str) -> bool {
    matches!(action, "vault_status" | "request_unlock")
}

fn enforce_locked_action_policy(app: &tauri::AppHandle, action: &str) -> Option<BridgeResponse> {
    if is_locked_permitted_action(action) {
        return None;
    }

    let state = app.try_state::<crate::state::AppState>()?;
    let vault = state.vault.lock().ok()?;
    if !vault.info().locked {
        return None;
    }

    let mfa_required = locked_mfa_required(app, &vault);
    Some(BridgeResponse::locked(
        mfa_required,
        main_window_minimized(app),
    ))
}

pub fn handle_bridge_request(app: &tauri::AppHandle, request: BridgeRequest) -> BridgeResponse {
    if !crate::nm_bridge::bridge_token::validate(&request.token) {
        return BridgeResponse::error("unauthorized");
    }

    if let Some(response) = enforce_locked_action_policy(app, &request.action) {
        return response;
    }

    match request.action.as_str() {
        "get_login" => handle_get_login(app, request.url.as_deref()),
        "vault_status" => handle_vault_status(app),
        "request_unlock" => handle_request_unlock(app),
        "open_new_secret" => handle_open_new_secret(app, request.password.as_deref()),
        _ => BridgeResponse::error("unknown action"),
    }
}

fn locked_mfa_required(app: &tauri::AppHandle, vault: &vault_core::Vault) -> bool {
    if vault.mfa_status().mfa_enabled {
        return true;
    }

    settings::load_settings(app)
        .map(|settings| settings.vault_mfa_configured)
        .unwrap_or(false)
}

fn handle_vault_status(app: &tauri::AppHandle) -> BridgeResponse {
    let state = match app.try_state::<crate::state::AppState>() {
        Some(state) => state,
        None => return BridgeResponse::unavailable(),
    };

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    let mfa_failed = state
        .bridge
        .lock()
        .map(|bridge| bridge.mfa_failed())
        .unwrap_or(false);
    let locked = vault.info().locked;
    let mfa_required = locked && locked_mfa_required(app, &vault);

    let minimized = main_window_minimized(app);
    BridgeResponse::vault_status(locked, mfa_required, mfa_failed, minimized)
}

fn handle_request_unlock(app: &tauri::AppHandle) -> BridgeResponse {
    let state = match app.try_state::<crate::state::AppState>() {
        Some(state) => state,
        None => return BridgeResponse::unavailable(),
    };

    let minimized = main_window_minimized(app);

    if state
        .bridge
        .lock()
        .map(|bridge| bridge.mfa_failed())
        .unwrap_or(false)
    {
        return BridgeResponse::mfa_failed(minimized);
    }

    let mfa_required = {
        let vault = match state.vault.lock() {
            Ok(guard) => guard,
            Err(e) => return BridgeResponse::error(e.to_string()),
        };

        if !vault.info().locked {
            return BridgeResponse::unlock_success();
        }

        locked_mfa_required(app, &vault)
    };

    if minimized {
        return BridgeResponse::locked(mfa_required, true);
    }

    focus_main_window_for_unlock(app, &state);
    BridgeResponse::focus_sent()
}

/// Notifies the desktop UI when a browser extension queued a new-secret prefill.
pub fn emit_new_secret_prefill_if_pending(app: &tauri::AppHandle) {
    let has_pending = app
        .try_state::<crate::state::AppState>()
        .is_some_and(|state| {
            state
                .bridge
                .lock()
                .ok()
                .is_some_and(|bridge| bridge.has_pending_new_secret())
        });

    if has_pending {
        let _ = app.emit("extension-new-secret-prefill", ());
    }
}

fn handle_open_new_secret(app: &tauri::AppHandle, password: Option<&str>) -> BridgeResponse {
    let Some(password) = password.map(str::trim).filter(|value| !value.is_empty()) else {
        return BridgeResponse::error("missing password");
    };

    let state = match app.try_state::<crate::state::AppState>() {
        Some(state) => state,
        None => return BridgeResponse::unavailable(),
    };

    if let Ok(mut bridge) = state.bridge.lock() {
        bridge.set_pending_new_secret(password.to_string());
    }

    focus_main_window(app, Some(&state));

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if vault.info().locked {
        let mfa_required = locked_mfa_required(app, &vault);
        return BridgeResponse::locked(mfa_required, main_window_minimized(app));
    }

    state.record_activity_for(&vault.info());
    emit_new_secret_prefill_if_pending(app);
    BridgeResponse::focus_sent()
}

fn handle_get_login(app: &tauri::AppHandle, url: Option<&str>) -> BridgeResponse {
    let Some(hostname) = url.map(str::trim).filter(|value| !value.is_empty()) else {
        return BridgeResponse::error("missing url");
    };

    let state = match app.try_state::<crate::state::AppState>() {
        Some(state) => state,
        None => return BridgeResponse::unavailable(),
    };

    if state
        .bridge
        .lock()
        .map(|bridge| bridge.mfa_failed())
        .unwrap_or(false)
    {
        return BridgeResponse::mfa_failed(main_window_minimized(app));
    }

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if vault.info().locked {
        let mfa_required = locked_mfa_required(app, &vault);
        return BridgeResponse::locked(mfa_required, main_window_minimized(app));
    }

    match vault.find_web_login_for_hostname(hostname) {
        Ok(Some((entry_id, username, password))) => {
            state.record_activity_for(&vault.info());
            let _ = vault.record_audit(vault_core::AuditAction::SecretAutofilled { id: entry_id });
            BridgeResponse::ok_login(username, password.to_string())
        }
        Ok(None) => BridgeResponse::not_found(),
        Err(vault_core::VaultError::Locked) => {
            let mfa_required = locked_mfa_required(app, &vault);
            BridgeResponse::locked(mfa_required, main_window_minimized(app))
        }
        Err(e) => BridgeResponse::error(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nm_bridge::framing::write_message;
    use crate::nm_bridge::protocol::{BridgeRequest, BridgeResponse};
    use crate::nm_bridge::session;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn locked_response_includes_mfa_required_flag() {
        let response = BridgeResponse::locked(true, false);
        assert_eq!(response.status, "locked");
        assert_eq!(response.mfa_required, Some(true));
        assert_eq!(response.locked, Some(true));
        assert_eq!(response.minimized, Some(false));
    }

    #[test]
    fn mfa_failed_response_has_expected_shape() {
        let response = BridgeResponse::mfa_failed(false);
        assert_eq!(response.status, "mfa_failed");
        assert_eq!(response.success, Some(false));
        assert_eq!(response.mfa_required, Some(true));
    }

    #[test]
    fn locked_action_allowlist_permits_status_and_unlock_only() {
        assert!(is_locked_permitted_action("vault_status"));
        assert!(is_locked_permitted_action("request_unlock"));
        assert!(!is_locked_permitted_action("get_login"));
        assert!(!is_locked_permitted_action("open_new_secret"));
    }

    #[test]
    fn bridge_reachable_while_locked_vault_status_returns_locked_not_unavailable() {
        with_mock_bridge_server(
            "vault_status",
            BridgeResponse::locked(false, false),
            |port| {
                let response = forward_bridge_request("vault_status", None, None);
                assert_ne!(response.status, "unavailable");
                assert_eq!(response.status, "locked");
                let _ = port;
            },
        );
    }

    #[test]
    fn get_login_while_locked_returns_locked_not_unavailable() {
        with_mock_bridge_server("get_login", BridgeResponse::locked(false, false), |_port| {
            let response = forward_bridge_request("get_login", Some("example.com"), None);
            assert_ne!(response.status, "unavailable");
            assert_eq!(response.status, "locked");
            assert_eq!(response.locked, Some(true));
        });
    }

    fn with_mock_bridge_server<F>(expected_action: &str, response: BridgeResponse, verify: F)
    where
        F: FnOnce(u16),
    {
        let _env = session::test_env();

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.set_nonblocking(true).expect("set_nonblocking");
        let port = listener.local_addr().expect("addr").port();
        session::write_session(port, "test-token").expect("write session");
        let expected_action = expected_action.to_string();
        let served = Arc::new(AtomicBool::new(false));
        let served_flag = Arc::clone(&served);

        let handle = thread::spawn(move || {
            let _ = listener.set_nonblocking(false);
            let (mut stream, _) = listener.accept().expect("accept");
            let mut len_buf = [0u8; 4];
            stream.read_exact(&mut len_buf).expect("read len");
            let len = u32::from_le_bytes(len_buf) as usize;
            let mut payload = vec![0u8; len];
            stream.read_exact(&mut payload).expect("read payload");
            let request: BridgeRequest = serde_json::from_slice(&payload).expect("request json");
            assert_eq!(request.action, expected_action);
            let response_bytes = serde_json::to_vec(&response).expect("response json");
            write_message(&mut stream, &response_bytes).expect("write response");
            served_flag.store(true, Ordering::SeqCst);
        });

        verify(port);
        handle.join().expect("server thread");
        assert!(served.load(Ordering::SeqCst));
    }
}
