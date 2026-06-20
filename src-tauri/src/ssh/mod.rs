use std::collections::HashMap;
use std::io::Cursor;
use std::net::ToSocketAddrs;
use std::sync::Arc;

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use russh::client;
use russh::ChannelMsg;
use russh_keys::key::KeyPair;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;
use zeroize::Zeroize;

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

struct ActiveSession {
    write_tx: mpsc::Sender<Vec<u8>>,
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

    pub fn connect(
        &self,
        app: AppHandle,
        host: &str,
        username: &str,
        private_key: &str,
        passphrase: Option<&str>,
    ) -> Result<SshSessionInfo, String> {
        let (hostname, port) = parse_host(host)?;
        let session_id = Uuid::new_v4().to_string();
        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>(256);

        {
            let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            sessions.insert(
                session_id.clone(),
                ActiveSession {
                    write_tx: write_tx.clone(),
                },
            );
        }

        let sid = session_id.clone();
        let display_host = format!("{hostname}:{port}");
        let info = SshSessionInfo {
            session_id: session_id.clone(),
            host: display_host,
            username: username.to_string(),
        };

        let mut key_material = private_key.to_string();
        let pass = passphrase.map(|s| s.to_string());
        let user = username.to_string();
        let host_name = hostname.clone();

        std::thread::spawn(move || {
            let result: Result<(), String> = (|| {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| format!("Tokio runtime failed: {e}"))?;
                rt.block_on(run_interactive_session(
                    &app,
                    &sid,
                    &host_name,
                    port,
                    &user,
                    &key_material,
                    pass.as_deref(),
                    write_rx,
                ))
            })();
            key_material.zeroize();
            let error = result.err().map(|e| e.to_string());
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
            .try_send(data.to_vec())
            .map_err(|_| "SSH session closed".to_string())
    }

    pub fn disconnect(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
    }

    pub fn disconnect_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Admin quick-connect: accept host keys (TOFU may follow in a later release).
        Ok(true)
    }
}

async fn run_interactive_session(
    app: &AppHandle,
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
    mut write_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let addr = resolve_socket_addr(host, port)?;
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, addr, SshClientHandler)
        .await
        .map_err(|e| format!("SSH connect failed: {e}"))?;

    let key_pair = load_key_pair(private_key, passphrase)?;
    let authenticated = handle
        .authenticate_publickey(username, Arc::new(key_pair))
        .await
        .map_err(|e| format!("SSH authentication failed: {e}"))?;

    if !authenticated {
        return Err("SSH authentication rejected".into());
    }

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("SSH channel failed: {e}"))?;

    channel
        .request_pty(false, "xterm-256color", 120, 32, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {e}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Shell start failed: {e}"))?;

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let payload = SshDataPayload {
                            session_id: session_id.to_string(),
                            data: BASE64.encode(data.as_ref()),
                        };
                        let _ = app.emit("ssh-data", payload);
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let payload = SshDataPayload {
                            session_id: session_id.to_string(),
                            data: BASE64.encode(data.as_ref()),
                        };
                        let _ = app.emit("ssh-data", payload);
                    }
                    Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            data = write_rx.recv() => {
                match data {
                    Some(bytes) => {
                        channel
                            .data(Cursor::new(bytes))
                            .await
                            .map_err(|e| format!("SSH write failed: {e}"))?;
                    }
                    None => break,
                }
            }
        }
    }

    let _ = channel.close().await;
    Ok(())
}

fn load_key_pair(private_key: &str, passphrase: Option<&str>) -> Result<KeyPair, String> {
    russh_keys::decode_secret_key(private_key, passphrase)
        .map_err(|e| format!("Invalid private key: {e}"))
}

fn parse_host(raw: &str) -> Result<(String, u16), String> {
    let mut host = raw.trim();
    if host.is_empty() {
        return Err("host is empty".into());
    }
    if let Some(stripped) = host.strip_prefix("ssh://") {
        host = stripped;
    }

    let (hostname, port) = if let Some((h, p)) = host.rsplit_once(':') {
        if h.contains(']') || !p.chars().all(|c| c.is_ascii_digit()) {
            (host.to_string(), 22)
        } else {
            let port: u16 = p.parse().map_err(|_| format!("invalid port: {p}"))?;
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
        .map_err(|e| format!("DNS lookup failed for {target}: {e}"))?
        .next()
        .ok_or_else(|| format!("no address found for {target}"))
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
