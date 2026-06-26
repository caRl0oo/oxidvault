// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::nm_bridge::focus::focus_main_window;
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

pub fn handle_bridge_request(
    app: &tauri::AppHandle,
    request: BridgeRequest,
    expected_token: &str,
) -> BridgeResponse {
    if request.token != expected_token {
        return BridgeResponse::error("unauthorized");
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

    BridgeResponse::vault_status(locked, mfa_required, mfa_failed)
}

fn handle_request_unlock(app: &tauri::AppHandle) -> BridgeResponse {
    focus_main_window(app);

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
        return BridgeResponse::mfa_failed();
    }

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if !vault.info().locked {
        return BridgeResponse::unlock_success();
    }

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

    focus_main_window(app);

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if vault.info().locked {
        let mfa_required = locked_mfa_required(app, &vault);
        return BridgeResponse::locked(mfa_required);
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
        return BridgeResponse::mfa_failed();
    }

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if vault.info().locked {
        let mfa_required = locked_mfa_required(app, &vault);
        return BridgeResponse::locked(mfa_required);
    }

    match vault.find_web_login_for_hostname(hostname) {
        Ok(Some((username, password))) => {
            state.record_activity_for(&vault.info());
            BridgeResponse::ok_login(username, password.to_string())
        }
        Ok(None) => BridgeResponse::not_found(),
        Err(vault_core::VaultError::Locked) => {
            let mfa_required = locked_mfa_required(app, &vault);
            BridgeResponse::locked(mfa_required)
        }
        Err(e) => BridgeResponse::error(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_response_includes_mfa_required_flag() {
        let response = BridgeResponse::locked(true);
        assert_eq!(response.status, "locked");
        assert_eq!(response.mfa_required, Some(true));
        assert_eq!(response.locked, Some(true));
    }

    #[test]
    fn mfa_failed_response_has_expected_shape() {
        let response = BridgeResponse::mfa_failed();
        assert_eq!(response.status, "mfa_failed");
        assert_eq!(response.success, Some(false));
        assert_eq!(response.mfa_required, Some(true));
    }
}
