// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

mod auth;
mod key_loader;

use std::collections::HashMap;
use std::io::Cursor;
use std::net::ToSocketAddrs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use auth::authenticate_publickey;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use key_loader::load_private_key_from_vault;
use russh::client::{self, Handler};
use russh::keys;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::timeout;
use uuid::Uuid;
use zeroize::Zeroizing;

const SSH_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_OUTPUT_BACKLOG_LIMIT: usize = 512 * 1024;

struct PtyDimensions {
    cols: u32,
    rows: u32,
}

impl PtyDimensions {
    fn clamped(cols: u32, rows: u32) -> Self {
        Self {
            cols: cols.clamp(20, 500),
            rows: rows.clamp(8, 200),
        }
    }
}

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

enum SessionInput {
    Stdin(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct ActiveSession {
    write_tx: mpsc::Sender<SessionInput>,
    output: Arc<SessionOutput>,
}

struct LiveSession {
    #[allow(dead_code)]
    handle: client::Handle<SshClientHandler>,
    channel: russh::Channel<client::Msg>,
}

pub struct SshManager {
    sessions: std::sync::Mutex<HashMap<String, ActiveSession>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Mutex::new(HashMap::new()),
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
        let pty = PtyDimensions::clamped(initial_cols, initial_rows);
        let (hostname, port) = parse_host(host)?;
        let session_id = Uuid::new_v4().to_string();
        let (write_tx, write_rx) = mpsc::channel::<SessionInput>(256);
        let output = Arc::new(SessionOutput::new());

        let display_host = format!("{hostname}:{port}");
        let info = SshSessionInfo {
            session_id: session_id.clone(),
            host: display_host,
            username: username.to_string(),
        };

        let key_material = Zeroizing::new(private_key.to_string());
        let pass = passphrase.map(|p| Zeroizing::new(p.to_string()));
        let pass_provided = pass.as_ref().is_some_and(|p| !p.is_empty());
        let user = username.trim().to_string();
        let host_name = hostname;

        let live = timeout(
            SSH_HANDSHAKE_TIMEOUT,
            open_interactive_shell(
                &host_name,
                port,
                &user,
                key_material.as_str(),
                pass.as_deref().map(|p| p.as_str()),
                pass_provided,
                pty,
            ),
        )
        .await
        .map_err(|_| "SSH connection timed out".to_string())??;

        {
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            sessions.insert(
                session_id.clone(),
                ActiveSession {
                    write_tx: write_tx.clone(),
                    output: Arc::clone(&output),
                },
            );
        }

        let sid = session_id.clone();
        async_runtime::spawn(async move {
            let error = run_session_loop(&app, &sid, live, write_rx, output)
                .await
                .err()
                .map(|e| e.to_string());
            let _ = app.emit(
                "ssh-closed",
                SshClosedPayload {
                    session_id: sid,
                    error,
                },
            );
        });

        Ok(info)
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        session
            .write_tx
            .try_send(SessionInput::Stdin(data.to_vec()))
            .map_err(|_| "SSH session closed".to_string())
    }

    pub fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        session
            .write_tx
            .try_send(SessionInput::Resize { cols, rows })
            .map_err(|_| "SSH session closed".to_string())
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
        let write_tx = {
            let sessions = self.sessions.lock();
            sessions
                .ok()
                .and_then(|map| map.get(session_id).map(|s| s.write_tx.clone()))
        };
        if let Some(tx) = write_tx {
            let _ = tx.try_send(SessionInput::Close);
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
    }

    pub fn disconnect_all(&self) {
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                let _ = session.write_tx.try_send(SessionInput::Close);
            }
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

struct SshClientHandler;

impl Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn auth_banner(
        &mut self,
        _banner: &str,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

async fn open_interactive_shell(
    host: &str,
    port: u16,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
    passphrase_was_provided: bool,
    pty: PtyDimensions,
) -> Result<LiveSession, String> {
    let addr = resolve_socket_addr(host, port)?;
    let config = Arc::new(client::Config::default());

    let mut handle = client::connect(config, addr, SshClientHandler)
        .await
        .map_err(|_| "SSH connection failed".to_string())?;

    let private_key = load_private_key_from_vault(private_key, passphrase)?;
    authenticate_publickey(&mut handle, username, private_key, passphrase_was_provided).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|_| "SSH session could not be opened".to_string())?;

    // want_reply=true: server must acknowledge PTY and shell before interactive I/O.
    channel
        .request_pty(true, "xterm-256color", pty.cols, pty.rows, 0, 0, &[])
        .await
        .map_err(|_| "SSH terminal setup failed".to_string())?;

    channel
        .request_shell(true)
        .await
        .map_err(|_| "SSH shell could not be started".to_string())?;

    Ok(LiveSession { handle, channel })
}

async fn run_session_loop(
    app: &AppHandle,
    session_id: &str,
    live: LiveSession,
    mut write_rx: mpsc::Receiver<SessionInput>,
    output: Arc<SessionOutput>,
) -> Result<(), String> {
    let LiveSession {
        handle: _handle,
        mut channel,
    } = live;

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        emit_ssh_data(app, session_id, &output, data.as_ref());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        emit_ssh_data(app, session_id, &output, data.as_ref());
                    }
                    Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            input = write_rx.recv() => {
                match input {
                    Some(SessionInput::Stdin(bytes)) => {
                        channel
                            .data(Cursor::new(bytes))
                            .await
                            .map_err(|_| "SSH write failed".to_string())?;
                    }
                    Some(SessionInput::Resize { cols, rows }) => {
                        channel
                            .window_change(cols, rows, 0, 0)
                            .await
                            .map_err(|_| "SSH terminal resize failed".to_string())?;
                    }
                    Some(SessionInput::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
        }
    }

    let _ = channel.close().await;
    Ok(())
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

fn parse_host(raw: &str) -> Result<(String, u16), String> {
    let mut host = raw.trim();
    if host.is_empty() {
        return Err("Host is empty".into());
    }
    if let Some(stripped) = host.strip_prefix("ssh://") {
        host = stripped;
    }

    let (hostname, port) = if let Some((h, p)) = host.rsplit_once(':') {
        if h.contains(']') || !p.chars().all(|c| c.is_ascii_digit()) {
            (host.to_string(), 22)
        } else {
            let port: u16 = p.parse().map_err(|_| "Invalid SSH port".to_string())?;
            (h.to_string(), port)
        }
    } else {
        (host.to_string(), 22)
    };

    Ok((hostname, port))
}

fn resolve_socket_addr(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    let target = format!("{host}:{port}");
    target
        .to_socket_addrs()
        .map_err(|_| format!("Host not found: {host}"))?
        .next()
        .ok_or_else(|| format!("Host not found: {host}"))
}

#[cfg(test)]
mod tests {
    use super::*;

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
