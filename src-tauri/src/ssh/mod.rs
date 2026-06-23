// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

mod auth;
mod key_loader;
mod provider;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use provider::{parse_host, ConnectContext, ConnectParams, RusshProvider, SshConnection};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;
use uuid::Uuid;
use zeroize::Zeroizing;

const SSH_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_OUTPUT_BACKLOG_LIMIT: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionInfo {
    pub session_id: String,
    pub host: String,
    pub username: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshDataPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshClosedPayload {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct SessionOutput {
    backlog: Mutex<Vec<Vec<u8>>>,
    streaming: AtomicBool,
}

impl SessionOutput {
    fn new() -> Self {
        Self {
            backlog: Mutex::new(Vec::new()),
            streaming: AtomicBool::new(false),
        }
    }

    fn push_backlog(&self, data: Vec<u8>) {
        if let Ok(mut backlog) = self.backlog.lock() {
            backlog.push(data);
            trim_backlog(&mut backlog);
        }
    }

    fn drain_backlog(&self) -> Vec<Vec<u8>> {
        self.backlog
            .lock()
            .map(|mut backlog| std::mem::take(&mut *backlog))
            .unwrap_or_default()
    }
}

fn trim_backlog(backlog: &mut Vec<Vec<u8>>) {
    let mut total: usize = backlog.iter().map(Vec::len).sum();
    while total > SSH_OUTPUT_BACKLOG_LIMIT {
        if let Some(removed) = backlog.first() {
            total = total.saturating_sub(removed.len());
        }
        backlog.remove(0);
    }
}

struct ActiveSession {
    output: Arc<SessionOutput>,
}

pub struct SshManager {
    provider: RusshProvider,
    sessions: Mutex<HashMap<String, ActiveSession>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            provider: RusshProvider::new(),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Starts an SSH session. `private_key` must come from the unlocked vault at runtime —
    /// never from source code or frontend IPC as raw PEM.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        app: AppHandle,
        host: &str,
        username: &str,
        private_key: &str,
        passphrase: Option<&str>,
        initial_cols: u32,
        initial_rows: u32,
    ) -> Result<SshSessionInfo, String> {
        let (hostname, port) = parse_host(host)?;
        let session_id = Uuid::new_v4().to_string();
        let output = Arc::new(SessionOutput::new());

        let key_material = Zeroizing::new(private_key.to_string());
        let pass = passphrase.map(|p| Zeroizing::new(p.to_string()));
        let user = username.trim().to_string();

        let ctx = build_connect_context(app.clone(), session_id.clone(), Arc::clone(&output));

        let connected = timeout(
            SSH_HANDSHAKE_TIMEOUT,
            self.provider.connect(
                ctx,
                ConnectParams {
                    host: &hostname,
                    port,
                    username: &user,
                    private_key: key_material.as_str(),
                    passphrase: pass.as_deref().map(|p| p.as_str()),
                    cols: initial_cols,
                    rows: initial_rows,
                },
            ),
        )
        .await
        .map_err(|_| "SSH connection timed out".to_string())??;

        {
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            sessions.insert(
                session_id.clone(),
                ActiveSession {
                    output: Arc::clone(&output),
                },
            );
        }

        Ok(SshSessionInfo {
            session_id: connected.session_id,
            host: connected.host,
            username: connected.username,
        })
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.provider.send_data_sync(session_id, data)
    }

    pub fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.provider.resize_pty_sync(session_id, cols, rows)
    }

    /// Drains buffered terminal output and enables live `ssh-data` events for the UI.
    pub fn begin_streaming(&self, session_id: &str) -> Result<Vec<String>, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        let drained = session.output.drain_backlog();
        session.output.streaming.store(true, Ordering::SeqCst);
        Ok(drained.iter().map(|chunk| BASE64.encode(chunk)).collect())
    }

    pub fn disconnect(&self, session_id: &str) {
        self.provider.disconnect_sync(session_id);
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
    }

    pub fn disconnect_all(&self) {
        let session_ids: Vec<String> = self
            .sessions
            .lock()
            .map(|sessions| sessions.keys().cloned().collect())
            .unwrap_or_default();

        for session_id in &session_ids {
            self.provider.disconnect_sync(session_id);
        }

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

fn build_connect_context(
    app: AppHandle,
    session_id: String,
    output: Arc<SessionOutput>,
) -> ConnectContext {
    let sid_for_output = session_id.clone();
    let app_for_output = app.clone();
    let output_for_callback = Arc::clone(&output);
    let on_output = Arc::new(move |data: &[u8]| {
        emit_ssh_data(&app_for_output, &sid_for_output, &output_for_callback, data);
    });

    let sid_for_closed = session_id.clone();
    let on_closed = Arc::new(move |error: Option<String>| {
        let _ = app.emit(
            "ssh-closed",
            SshClosedPayload {
                session_id: sid_for_closed.clone(),
                error,
            },
        );
    });

    ConnectContext {
        session_id,
        on_output,
        on_closed,
    }
}

fn emit_ssh_data(app: &AppHandle, session_id: &str, output: &SessionOutput, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if output.streaming.load(Ordering::SeqCst) {
        let payload = SshDataPayload {
            session_id: session_id.to_string(),
            data: BASE64.encode(data),
        };
        let _ = app.emit("ssh-data", payload);
    } else {
        output.push_backlog(data.to_vec());
    }
}

#[cfg(test)]
mod tests {
    use super::provider::parse_host;

    #[test]
    fn parses_host_with_port() {
        assert_eq!(
            parse_host("10.0.0.1:2222").unwrap(),
            ("10.0.0.1".into(), 2222)
        );
    }

    #[test]
    fn parses_host_default_port() {
        assert_eq!(
            parse_host("server.example.com").unwrap(),
            ("server.example.com".into(), 22)
        );
    }
}
