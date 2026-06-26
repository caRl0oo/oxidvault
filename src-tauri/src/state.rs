// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use vault_core::license::{community_license, load_license, ActiveLicense};

use crate::clipboard::SecureClipboard;
use crate::nm_bridge::BridgeAuthState;
use crate::ssh::SshManager;
use vault_core::VaultInfo;

pub struct AppState {
    pub vault: Mutex<vault_core::Vault>,
    pub ssh: SshManager,
    pub clipboard: SecureClipboard,
    pub bridge: Mutex<BridgeAuthState>,
    /// Suppresses lock-on-minimize while the NM bridge restores window focus.
    pub nm_bridge_focusing: Mutex<bool>,
    /// Format version of the currently loaded vault (1, 2, or 3).
    pub vault_format_version: Mutex<u8>,
    pub license: Mutex<ActiveLicense>,
    last_activity_secs: AtomicU64,
    idle_warning_sent: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        let license = load_license().unwrap_or_else(|err| {
            eprintln!("License warning: {err} — falling back to Community Edition");
            community_license()
        });

        Self {
            vault: Mutex::new(vault_core::Vault::new()),
            ssh: SshManager::new(),
            clipboard: SecureClipboard::new(),
            bridge: Mutex::new(BridgeAuthState::default()),
            nm_bridge_focusing: Mutex::new(false),
            vault_format_version: Mutex::new(0),
            license: Mutex::new(license),
            last_activity_secs: AtomicU64::new(unix_secs_now()),
            idle_warning_sent: AtomicBool::new(false),
        }
    }

    /// Returns true if the current vault is v3 (multi-user).
    pub fn is_multi_user(&self) -> bool {
        self.vault_format_version
            .lock()
            .map(|version| *version == vault_core::format::FORMAT_VERSION_V3 as u8)
            .unwrap_or(false)
    }

    /// Returns the current username if the vault is v3 and unlocked.
    pub fn current_username(&self) -> Option<String> {
        let vault = self.vault.lock().ok()?;
        vault.get_current_user_public().map(|user| user.username)
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

    pub fn is_nm_bridge_focusing(&self) -> bool {
        self.nm_bridge_focusing
            .lock()
            .map(|guard| *guard)
            .unwrap_or(false)
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
