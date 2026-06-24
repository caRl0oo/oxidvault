// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! Reusable vault lock guard for sensitive Tauri commands.

use tauri::State;

use crate::state::AppState;

/// IPC error returned when a command requires an unlocked vault.
pub const VAULT_LOCKED_MESSAGE: &str = "Vault locked";

/// Returns `Ok(())` only when the vault is initialized and unlocked.
pub fn ensure_vault_unlocked(state: &State<'_, AppState>) -> Result<(), String> {
    ensure_vault_unlocked_state(state.inner())
}

/// Same check for callers that already hold `&AppState`.
pub fn ensure_vault_unlocked_state(state: &AppState) -> Result<(), String> {
    if state.is_vault_unlocked() {
        Ok(())
    } else {
        Err(VAULT_LOCKED_MESSAGE.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_message_is_stable_for_frontend() {
        assert_eq!(VAULT_LOCKED_MESSAGE, "Vault locked");
    }
}
