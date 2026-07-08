// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Token-bucket rate limiting for bridge `get_login` requests.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Instant;

const MAX_GET_LOGIN_PER_MINUTE: f64 = 10.0;
const REFILL_PER_SEC: f64 = MAX_GET_LOGIN_PER_MINUTE / 60.0;

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

impl Bucket {
    fn new() -> Self {
        Self {
            tokens: MAX_GET_LOGIN_PER_MINUTE,
            last_refill: Instant::now(),
        }
    }

    fn try_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        if elapsed > 0.0 {
            self.tokens = (self.tokens + elapsed * REFILL_PER_SEC).min(MAX_GET_LOGIN_PER_MINUTE);
            self.last_refill = now;
        }
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub struct GetLoginRateLimiter {
    // Keyed by peer IP only: each bridge request arrives on a fresh TCP connection
    // with a new ephemeral source port, so keying by full SocketAddr would hand
    // every request its own bucket and disable the limit entirely.
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

impl GetLoginRateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, peer: SocketAddr) -> bool {
        let Ok(mut buckets) = self.buckets.lock() else {
            return false;
        };
        buckets
            .entry(peer.ip())
            .or_insert_with(Bucket::new)
            .try_consume()
    }
}

impl Default for GetLoginRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn allows_burst_then_blocks() {
        let limiter = GetLoginRateLimiter::new();
        let peer = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 42_001);

        for _ in 0..10 {
            assert!(limiter.allow(peer));
        }
        assert!(!limiter.allow(peer));
    }

    #[test]
    fn connections_from_different_ports_share_one_bucket() {
        let limiter = GetLoginRateLimiter::new();

        for port in 0..10u16 {
            let peer = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 50_000 + port);
            assert!(limiter.allow(peer));
        }
        let fresh_port = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 60_000);
        assert!(
            !limiter.allow(fresh_port),
            "a new source port must not receive a fresh token bucket"
        );
    }
}
