// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::LazyLock;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use vault_core::AuditAction;

use crate::nm_bridge::bridge_token;
use crate::nm_bridge::client::handle_bridge_request;
use crate::nm_bridge::framing::MAX_MESSAGE_LEN;
use crate::nm_bridge::protocol::{BridgeRequest, BridgeResponse};
use crate::nm_bridge::rate_limit::GetLoginRateLimiter;
use crate::state::AppState;

static RATE_LIMITER: LazyLock<GetLoginRateLimiter> = LazyLock::new(GetLoginRateLimiter::new);

pub fn spawn_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_server(app).await {
            eprintln!("native messaging bridge server failed: {err}");
        }
    });
}

pub fn publish_bridge_session() -> Result<(), String> {
    bridge_token::publish()
}

pub fn revoke_bridge_session() {
    bridge_token::revoke();
}

async fn run_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bridge bind failed: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    bridge_token::init(port);
    if let Err(err) = bridge_token::publish() {
        eprintln!("native messaging bridge: failed to publish initial session: {err}");
    }

    loop {
        let (mut stream, peer) = listener
            .accept()
            .await
            .map_err(|e| format!("bridge accept failed: {e}"))?;
        let app = app.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(err) = handle_connection(app, peer, &mut stream).await {
                eprintln!("native messaging bridge connection failed: {err}");
            }
        });
    }
}

async fn handle_connection(
    app: AppHandle,
    peer: std::net::SocketAddr,
    stream: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let payload = read_message_async(stream).await?;
    let Some(payload) = payload else {
        return Ok(());
    };

    let request: BridgeRequest =
        serde_json::from_slice(&payload).map_err(|e| format!("invalid bridge request: {e}"))?;

    // Reject unauthenticated peers before they can consume rate-limit tokens or
    // trigger BridgeThrottled audit noise. handle_bridge_request re-validates.
    if !crate::nm_bridge::bridge_token::validate(&request.token) {
        let response = BridgeResponse::error("unauthorized");
        let response_bytes =
            serde_json::to_vec(&response).map_err(|e| format!("bridge response encode: {e}"))?;
        return write_message_async(stream, &response_bytes).await;
    }

    if request.action == "get_login" && !RATE_LIMITER.allow(peer) {
        eprintln!("native messaging bridge: get_login rate limited from {peer}");
        log_bridge_throttled(&app);
        let response = BridgeResponse::error("rate_limited");
        let response_bytes =
            serde_json::to_vec(&response).map_err(|e| format!("bridge response encode: {e}"))?;
        return write_message_async(stream, &response_bytes).await;
    }

    let response = handle_bridge_request(&app, request);
    let response_bytes =
        serde_json::to_vec(&response).map_err(|e| format!("bridge response encode: {e}"))?;
    write_message_async(stream, &response_bytes).await
}

fn log_bridge_throttled(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(vault) = state.vault.lock() else {
        return;
    };
    if vault.info().path.is_some() {
        let _ = vault.record_audit(AuditAction::BridgeThrottled);
    }
}

async fn read_message_async(stream: &mut tokio::net::TcpStream) -> Result<Option<Vec<u8>>, String> {
    let mut len_buf = [0u8; 4];
    match stream.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(format!("bridge read length: {e}")),
    }

    let len = u32::from_le_bytes(len_buf);
    if len == 0 || len > MAX_MESSAGE_LEN {
        return Err("invalid bridge frame length".into());
    }

    let mut payload = vec![0u8; len as usize];
    stream
        .read_exact(&mut payload)
        .await
        .map_err(|e| format!("bridge read payload: {e}"))?;
    Ok(Some(payload))
}

async fn write_message_async(
    stream: &mut tokio::net::TcpStream,
    json: &[u8],
) -> Result<(), String> {
    if json.len() > MAX_MESSAGE_LEN as usize {
        return Err("bridge response too large".into());
    }

    let len =
        u32::try_from(json.len()).map_err(|_| "bridge response length overflow".to_string())?;
    stream
        .write_all(&len.to_le_bytes())
        .await
        .map_err(|e| format!("bridge write length: {e}"))?;
    stream
        .write_all(json)
        .await
        .map_err(|e| format!("bridge write payload: {e}"))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("bridge flush: {e}"))?;
    Ok(())
}
