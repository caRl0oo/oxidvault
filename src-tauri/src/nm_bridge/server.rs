// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Arc;

use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

use crate::nm_bridge::client::handle_bridge_request;
use crate::nm_bridge::framing::MAX_MESSAGE_LEN;
use crate::nm_bridge::protocol::BridgeRequest;
use crate::nm_bridge::session;

pub fn spawn_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_server(app).await {
            eprintln!("native messaging bridge server failed: {err}");
        }
    });
}

async fn run_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bridge bind failed: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = Uuid::new_v4().to_string();
    session::remove_session();
    session::write_session(port, &token)?;

    let token = Arc::new(token);

    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("bridge accept failed: {e}"))?;
        let app = app.clone();
        let token = Arc::clone(&token);

        tauri::async_runtime::spawn(async move {
            if let Err(err) = handle_connection(app, &token, &mut stream).await {
                eprintln!("native messaging bridge connection failed: {err}");
            }
        });
    }
}

async fn handle_connection(
    app: AppHandle,
    token: &str,
    stream: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let payload = read_message_async(stream).await?;
    let Some(payload) = payload else {
        return Ok(());
    };

    let request: BridgeRequest =
        serde_json::from_slice(&payload).map_err(|e| format!("invalid bridge request: {e}"))?;
    let response = handle_bridge_request(&app, request, token);
    let response_bytes =
        serde_json::to_vec(&response).map_err(|e| format!("bridge response encode: {e}"))?;
    write_message_async(stream, &response_bytes).await
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
