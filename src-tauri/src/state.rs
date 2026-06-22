// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use crate::clipboard::SecureClipboard;
use crate::nm_bridge::BridgeAuthState;
use crate::ssh::SshManager;

pub struct AppState {
    pub vault: Mutex<vault_core::Vault>,
    pub ssh: SshManager,
    pub clipboard: SecureClipboard,
    pub bridge: Mutex<BridgeAuthState>,
    last_activity: Mutex<SystemTime>,
    idle_warning_sent: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vault: Mutex::new(vault_core::Vault::new()),
            ssh: SshManager::new(),
            clipboard: SecureClipboard::new(),
            bridge: Mutex::new(BridgeAuthState::default()),
            last_activity: Mutex::new(SystemTime::now()),
            idle_warning_sent: AtomicBool::new(false),
        }
    }

    /// Updates the last user/vault activity timestamp and clears any pending idle warning.
    pub fn touch_activity(&self) {
        if let Ok(mut guard) = self.last_activity.lock() {
            *guard = SystemTime::now();
        }
        self.clear_idle_warning();
    }

    /// Records activity only when the vault is initialized and unlocked.
    pub fn touch_activity_if_unlocked(&self) {
        if self.is_vault_unlocked() {
            self.touch_activity();
        }
    }

    pub fn is_vault_unlocked(&self) -> bool {
        self.vault
            .lock()
            .map(|vault| {
                let info = vault.info();
                info.initialized && !info.locked
            })
            .unwrap_or(false)
    }

    pub fn elapsed_since_activity(&self) -> Duration {
        self.last_activity
            .lock()
            .ok()
            .and_then(|instant| SystemTime::now().duration_since(*instant).ok())
            .unwrap_or(Duration::ZERO)
    }

    /// Returns `true` when the idle warning event should be emitted (once per idle cycle).
    pub fn try_mark_idle_warning_sent(&self) -> bool {
        !self.idle_warning_sent.swap(true, Ordering::SeqCst)
    }

    pub fn clear_idle_warning(&self) {
        self.idle_warning_sent.store(false, Ordering::SeqCst);
    }
}
