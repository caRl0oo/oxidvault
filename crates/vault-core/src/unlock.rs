// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! Two-step vault unlock when TOTP MFA is enabled.

use serde::{Deserialize, Serialize};

use crate::vault::VaultInfo;

/// Result of the first unlock step (master password validated).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnlockStep {
    /// Vault is fully unlocked — no MFA configured.
    Complete,
    /// Master password accepted; TOTP code required before keys are committed.
    MfaRequired,
}

/// IPC response for `unlock_vault` / `open_vault` when MFA may gate completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockVaultResponse {
    pub unlocked: bool,
    pub mfa_required: bool,
    pub vault: VaultInfo,
}

impl UnlockVaultResponse {
    pub fn complete(vault: VaultInfo) -> Self {
        Self {
            unlocked: true,
            mfa_required: false,
            vault,
        }
    }

    pub fn mfa_pending(vault: VaultInfo) -> Self {
        Self {
            unlocked: false,
            mfa_required: true,
            vault,
        }
    }
}
