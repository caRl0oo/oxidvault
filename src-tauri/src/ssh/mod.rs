// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

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

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SshConnectResponse {
    Connected {
        session: SshSessionInfo,
    },
    #[serde(rename_all = "camelCase")]
    UnknownHost {
        fingerprint: String,
        session_id: String,
        host: String,
        username: String,
    },
    #[serde(rename_all = "camelCase")]
    HostKeyMismatch {
        expected: String,
        got: String,
    },
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

enum SessionTrustState {
    Pending {
        entry_id: String,
        fingerprint: String,
    },
    Active,
}

struct ManagedSession {
    output: Arc<SessionOutput>,
    host: String,
    username: String,
    trust: SessionTrustState,
}

pub struct SshManager {
    provider: RusshProvider,
    sessions: Mutex<HashMap<String, ManagedSession>>,
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
        entry_id: &str,
        host: &str,
        username: &str,
        private_key: &str,
        passphrase: Option<&str>,
        known_host_fingerprint: Option<&str>,
        initial_cols: u32,
        initial_rows: u32,
    ) -> Result<SshConnectResponse, String> {
        let (hostname, port) = parse_host(host)?;
        let session_id = Uuid::new_v4().to_string();
        let output = Arc::new(SessionOutput::new());
        let captured_fingerprint = Arc::new(Mutex::new(None));

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
                    captured_fingerprint: Arc::clone(&captured_fingerprint),
                },
            ),
        )
        .await
        .map_err(|_| "SSH connection timed out".to_string())??;

        let observed_fingerprint = captured_fingerprint
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "SSH host key fingerprint was not captured".to_string())?;

        let session_info = SshSessionInfo {
            session_id: connected.session_id.clone(),
            host: connected.host,
            username: connected.username,
        };

        match known_host_fingerprint {
            None => {
                self.insert_session(
                    connected.session_id.clone(),
                    ManagedSession {
                        output,
                        host: session_info.host.clone(),
                        username: session_info.username.clone(),
                        trust: SessionTrustState::Pending {
                            entry_id: entry_id.to_string(),
                            fingerprint: observed_fingerprint.clone(),
                        },
                    },
                )?;
                Ok(SshConnectResponse::UnknownHost {
                    fingerprint: observed_fingerprint,
                    session_id: session_info.session_id,
                    host: session_info.host,
                    username: session_info.username,
                })
            }
            Some(stored) if stored != observed_fingerprint => {
                self.provider.disconnect_sync(&connected.session_id);
                Ok(SshConnectResponse::HostKeyMismatch {
                    expected: stored.to_string(),
                    got: observed_fingerprint,
                })
            }
            Some(_) => {
                self.insert_session(
                    connected.session_id.clone(),
                    ManagedSession {
                        output,
                        host: session_info.host.clone(),
                        username: session_info.username.clone(),
                        trust: SessionTrustState::Active,
                    },
                )?;
                Ok(SshConnectResponse::Connected {
                    session: session_info,
                })
            }
        }
    }

    pub fn promote_pending_session(
        &self,
        session_id: &str,
        entry_id: &str,
        fingerprint: &str,
    ) -> Result<SshSessionInfo, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;

        let SessionTrustState::Pending {
            entry_id: pending_entry,
            fingerprint: pending_fp,
        } = &session.trust
        else {
            return Err("SSH session is not awaiting host key trust".into());
        };

        let pending_entry = pending_entry.clone();
        let pending_fp = pending_fp.clone();

        if pending_entry != entry_id {
            return Err("SSH session does not belong to this entry".into());
        }
        if pending_fp != fingerprint {
            return Err("SSH host key fingerprint mismatch".into());
        }

        session.trust = SessionTrustState::Active;
        let host = session.host.clone();
        let username = session.username.clone();
        Ok(SshSessionInfo {
            session_id: session_id.to_string(),
            host,
            username,
        })
    }

    pub fn reject_pending_session(&self, session_id: &str) -> Result<(), String> {
        let pending = {
            let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| "SSH session not found".to_string())?;
            matches!(session.trust, SessionTrustState::Pending { .. })
        };

        if !pending {
            return Err("SSH session is not awaiting host key trust".into());
        }

        self.disconnect(session_id);
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.ensure_active(session_id)?;
        self.provider.send_data_sync(session_id, data)
    }

    pub fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.ensure_active(session_id)?;
        self.provider.resize_pty_sync(session_id, cols, rows)
    }

    /// Drains buffered terminal output and enables live `ssh-data` events for the UI.
    pub fn begin_streaming(&self, session_id: &str) -> Result<Vec<String>, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        if matches!(session.trust, SessionTrustState::Pending { .. }) {
            return Err("SSH session awaiting host key trust".into());
        }
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

    fn insert_session(&self, session_id: String, session: ManagedSession) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(session_id, session);
        Ok(())
    }

    fn ensure_active(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        if matches!(session.trust, SessionTrustState::Pending { .. }) {
            return Err("SSH session awaiting host key trust".into());
        }
        Ok(())
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
