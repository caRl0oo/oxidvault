// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::{MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use tauri::State;
use vault_core::VaultInfo;

use crate::state::AppState;

const PERFORM_LOCK_TIMEOUT: Duration = Duration::from_secs(5);
const PERFORM_LOCK_RETRY: Duration = Duration::from_millis(5);

fn lock_vault_with_timeout(state: &AppState) -> Result<MutexGuard<'_, vault_core::Vault>, String> {
    let deadline = Instant::now() + PERFORM_LOCK_TIMEOUT;

    loop {
        match state.vault.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err("vault lock timeout".into());
                }
                std::thread::sleep(PERFORM_LOCK_RETRY);
            }
            Err(TryLockError::Poisoned(err)) => return Err(err.to_string()),
        }
    }
}

/// Locks the vault (RAM purge + SSH disconnect). No-op if already locked.
pub fn perform_lock(state: &AppState) -> Result<VaultInfo, String> {
    crate::commands::ssh::disconnect_all_ssh(state);
    state.clipboard.cancel_pending();
    let mut vault = lock_vault_with_timeout(state)?;
    if vault.info().locked {
        return Ok(vault.info());
    }
    vault.lock();
    crate::nm_bridge::revoke_bridge_session();
    Ok(vault.info())
}

pub fn lock_vault_state(state: State<'_, AppState>) -> Result<VaultInfo, String> {
    perform_lock(&state)
}
