use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use tauri::Manager;

use crate::nm_bridge::framing::{read_message, write_message};
use crate::nm_bridge::protocol::{BridgeRequest, BridgeResponse};
use crate::nm_bridge::session;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Forwards a `get_login` request to the desktop app's localhost bridge.
pub fn request_get_login(page_hostname: &str) -> BridgeResponse {
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
        action: "get_login".into(),
        url: Some(page_hostname.to_string()),
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
        _ => BridgeResponse::error("unknown action"),
    }
}

fn handle_get_login(app: &tauri::AppHandle, url: Option<&str>) -> BridgeResponse {
    let Some(hostname) = url.map(str::trim).filter(|value| !value.is_empty()) else {
        return BridgeResponse::error("missing url");
    };

    let state = match app.try_state::<crate::commands::AppState>() {
        Some(state) => state,
        None => return BridgeResponse::unavailable(),
    };

    let vault = match state.vault.lock() {
        Ok(guard) => guard,
        Err(e) => return BridgeResponse::error(e.to_string()),
    };

    if vault.info().locked {
        return BridgeResponse::locked();
    }

    match vault.find_web_login_for_hostname(hostname) {
        Ok(Some((username, password))) => BridgeResponse::ok_login(username, password.to_string()),
        Ok(None) => BridgeResponse::not_found(),
        Err(vault_core::VaultError::Locked) => BridgeResponse::locked(),
        Err(e) => BridgeResponse::error(e.to_string()),
    }
}
