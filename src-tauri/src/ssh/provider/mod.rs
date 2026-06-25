// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! SSH provider abstraction — swappable backends (`russh`, `ssh2`, …).

mod russh_provider;

use std::sync::{Arc, Mutex};

pub use russh_provider::RusshProvider;

/// Metadata returned after a successful SSH handshake and shell open.
#[derive(Debug, Clone)]
pub struct ConnectedSession {
    pub session_id: String,
    pub host: String,
    pub username: String,
}

pub type OutputCallback = Arc<dyn Fn(&[u8]) + Send + Sync>;
pub type ClosedCallback = Arc<dyn Fn(Option<String>) + Send + Sync>;

/// Runtime hooks supplied by `SshManager` when opening a session (Tauri events, backlog).
pub struct ConnectContext {
    pub session_id: String,
    pub on_output: OutputCallback,
    pub on_closed: ClosedCallback,
}

/// Credential and terminal parameters for opening an SSH session.
pub struct ConnectParams<'a> {
    pub host: &'a str,
    pub port: u16,
    pub username: &'a str,
    pub private_key: &'a str,
    pub passphrase: Option<&'a str>,
    pub cols: u32,
    pub rows: u32,
    pub captured_fingerprint: Arc<Mutex<Option<String>>>,
}

/// Backend-agnostic contract for interactive SSH sessions.
///
/// Implementations must keep private keys and passphrases in Rust memory only
/// (e.g. `Zeroizing`) and must not expose secrets across the Tauri IPC boundary.
#[allow(dead_code)]
pub trait SshConnection: Send + Sync {
    /// Connect, authenticate, request PTY, open a shell, and spawn the I/O loop.
    async fn connect(
        &self,
        ctx: ConnectContext,
        params: ConnectParams<'_>,
    ) -> Result<ConnectedSession, String>;

    /// Send stdin bytes to the remote shell.
    async fn send_data(&self, session_id: &str, data: &[u8]) -> Result<(), String>;

    /// Resize the remote PTY (terminal columns and rows).
    async fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String>;

    /// Gracefully close the session (channel close, cleanup).
    async fn disconnect(&self, session_id: &str) -> Result<(), String>;
}

/// Parses `host`, optional `:port`, and optional `ssh://` prefix.
pub(crate) fn parse_host(raw: &str) -> Result<(String, u16), String> {
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
