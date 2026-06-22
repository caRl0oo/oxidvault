// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::clipboard::SecureClipboard;
use crate::nm_bridge::BridgeAuthState;
use crate::ssh::SshManager;
use vault_core::VaultInfo;

pub struct AppState {
    pub vault: Mutex<vault_core::Vault>,
    pub ssh: SshManager,
    pub clipboard: SecureClipboard,
    pub bridge: Mutex<BridgeAuthState>,
    last_activity_secs: AtomicU64,
    idle_warning_sent: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vault: Mutex::new(vault_core::Vault::new()),
            ssh: SshManager::new(),
            clipboard: SecureClipboard::new(),
            bridge: Mutex::new(BridgeAuthState::default()),
            last_activity_secs: AtomicU64::new(unix_secs_now()),
            idle_warning_sent: AtomicBool::new(false),
        }
    }

    pub fn touch_activity(&self) {
        self.last_activity_secs
            .store(unix_secs_now(), Ordering::Relaxed);
        self.clear_idle_warning();
    }

    pub fn record_activity_for(&self, info: &VaultInfo) {
        if info.initialized && !info.locked {
            self.touch_activity();
        }
    }

    pub fn touch_activity_if_unlocked(&self) {
        let Ok(vault) = self.vault.lock() else {
            return;
        };
        self.record_activity_for(&vault.info());
    }

    pub fn is_vault_unlocked(&self) -> bool {
        self.vault
            .lock()
            .map(|vault| vault_is_unlocked(&vault.info()))
            .unwrap_or(false)
    }

    pub fn elapsed_since_activity(&self) -> Duration {
        let then = self.last_activity_secs.load(Ordering::Relaxed);
        let now = unix_secs_now();
        Duration::from_secs(now.saturating_sub(then))
    }

    pub fn try_mark_idle_warning_sent(&self) -> bool {
        !self.idle_warning_sent.swap(true, Ordering::Relaxed)
    }

    pub fn clear_idle_warning(&self) {
        self.idle_warning_sent.store(false, Ordering::Relaxed);
    }
}

fn vault_is_unlocked(info: &VaultInfo) -> bool {
    info.initialized && !info.locked
}

fn unix_secs_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
