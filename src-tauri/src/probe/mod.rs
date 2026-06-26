// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use tokio::net::TcpStream;
use tokio::time::timeout;

const TCP_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Returns `true` when a TCP handshake to `host:port` succeeds within the timeout.
pub async fn tcp_reachable(host: &str, port: u16) -> bool {
    if host.trim().is_empty() || port == 0 {
        return false;
    }

    let addr = format!("{host}:{port}");
    match timeout(TCP_PROBE_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => {
            drop(stream);
            true
        }
        _ => false,
    }
}
