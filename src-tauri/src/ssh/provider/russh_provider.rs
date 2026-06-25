// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! `russh`-backed implementation of [`SshConnection`](super::SshConnection).

use std::collections::HashMap;
use std::io::Cursor;
use std::net::ToSocketAddrs;
use std::sync::{Arc, Mutex};

use russh::client::{self, Handler};
use russh::keys::{self, HashAlg};
use russh::ChannelMsg;
use tokio::sync::mpsc;

use crate::ssh::auth::authenticate_publickey;
use crate::ssh::key_loader::load_private_key_from_vault;

use super::{ConnectContext, ConnectParams, ConnectedSession, OutputCallback, SshConnection};

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

enum SessionInput {
    Stdin(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct LiveSession {
    #[allow(dead_code)]
    handle: client::Handle<SshClientHandler>,
    channel: russh::Channel<client::Msg>,
}

struct SshClientHandler {
    captured_fingerprint: Arc<Mutex<Option<String>>>,
}

impl Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format_ssh_host_fingerprint(server_public_key);
        if let Ok(mut slot) = self.captured_fingerprint.lock() {
            *slot = Some(fingerprint);
        }
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

/// Interactive SSH sessions via the `russh` crate.
pub struct RusshProvider {
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<SessionInput>>>>,
}

impl RusshProvider {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn try_send_input(&self, session_id: &str, input: SessionInput) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let tx = sessions
            .get(session_id)
            .ok_or_else(|| "SSH session not found".to_string())?;
        tx.try_send(input)
            .map_err(|_| "SSH session closed".to_string())
    }

    fn remove_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
    }

    pub(crate) fn send_data_sync(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.try_send_input(session_id, SessionInput::Stdin(data.to_vec()))
    }

    pub(crate) fn resize_pty_sync(
        &self,
        session_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(), String> {
        self.try_send_input(session_id, SessionInput::Resize { cols, rows })
    }

    pub(crate) fn disconnect_sync(&self, session_id: &str) {
        let _ = self.try_send_input(session_id, SessionInput::Close);
        self.remove_session(session_id);
    }
}

impl Default for RusshProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl SshConnection for RusshProvider {
    async fn connect(
        &self,
        ctx: ConnectContext,
        params: ConnectParams<'_>,
    ) -> Result<ConnectedSession, String> {
        let pty = PtyDimensions::clamped(params.cols, params.rows);
        let pass_provided = params.passphrase.is_some_and(|p| !p.is_empty());
        let user = params.username.trim().to_string();
        let display_host = format!("{}:{}", params.host, params.port);

        let live = open_interactive_shell(
            params.host,
            params.port,
            &user,
            params.private_key,
            params.passphrase,
            pass_provided,
            pty,
            Arc::clone(&params.captured_fingerprint),
        )
        .await?;

        let (write_tx, write_rx) = mpsc::channel::<SessionInput>(256);
        {
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            sessions.insert(ctx.session_id.clone(), write_tx);
        }

        let on_output = Arc::clone(&ctx.on_output);
        let on_closed = Arc::clone(&ctx.on_closed);
        let cleanup_id = ctx.session_id.clone();
        let sessions = Arc::clone(&self.sessions);

        tokio::spawn(async move {
            let error = run_session_loop(live, write_rx, &on_output)
                .await
                .err()
                .map(|e| e.to_string());
            on_closed(error);
            if let Ok(mut map) = sessions.lock() {
                map.remove(&cleanup_id);
            }
        });

        Ok(ConnectedSession {
            session_id: ctx.session_id,
            host: display_host,
            username: user,
        })
    }

    async fn send_data(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        self.send_data_sync(session_id, data)
    }

    async fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.resize_pty_sync(session_id, cols, rows)
    }

    async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        self.disconnect_sync(session_id);
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
async fn open_interactive_shell(
    host: &str,
    port: u16,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
    passphrase_was_provided: bool,
    pty: PtyDimensions,
    captured_fingerprint: Arc<Mutex<Option<String>>>,
) -> Result<LiveSession, String> {
    let addr = resolve_socket_addr(host, port)?;
    let config = Arc::new(client::Config::default());

    let handler = SshClientHandler {
        captured_fingerprint,
    };
    let mut handle = client::connect(config, addr, handler)
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
    live: LiveSession,
    mut write_rx: mpsc::Receiver<SessionInput>,
    on_output: &OutputCallback,
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
                        on_output(data.as_ref());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        on_output(data.as_ref());
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

fn resolve_socket_addr(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    let target = format!("{host}:{port}");
    target
        .to_socket_addrs()
        .map_err(|_| format!("Host not found: {host}"))?
        .next()
        .ok_or_else(|| format!("Host not found: {host}"))
}

pub(crate) fn format_ssh_host_fingerprint(public_key: &keys::PublicKey) -> String {
    public_key.fingerprint(HashAlg::Sha256).to_string()
}
