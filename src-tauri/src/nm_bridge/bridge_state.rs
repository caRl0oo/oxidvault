// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use zeroize::Zeroizing;

/// Tracks browser-bridge unlock outcomes and one-shot secret prefill payloads.
#[derive(Debug, Default)]
pub struct BridgeAuthState {
    pub mfa_unlock_failed: bool,
    pending_new_secret_password: Option<Zeroizing<String>>,
}

impl BridgeAuthState {
    pub fn note_mfa_failed(&mut self) {
        self.mfa_unlock_failed = true;
    }

    pub fn clear_mfa_failed(&mut self) {
        self.mfa_unlock_failed = false;
    }

    pub fn mfa_failed(&self) -> bool {
        self.mfa_unlock_failed
    }

    pub fn set_pending_new_secret(&mut self, password: String) {
        self.pending_new_secret_password = Some(Zeroizing::new(password));
    }

    pub fn has_pending_new_secret(&self) -> bool {
        self.pending_new_secret_password.is_some()
    }

    pub fn take_pending_new_secret(&mut self) -> Option<Zeroizing<String>> {
        self.pending_new_secret_password.take()
    }
}
