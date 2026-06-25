// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! Vault unlock outcomes and IPC response types.

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
    pub is_multi_user: bool,
    pub current_username: Option<String>,
    pub vault: VaultInfo,
}

impl UnlockVaultResponse {
    pub fn complete(vault: VaultInfo) -> Self {
        let is_multi_user = vault.is_multi_user;
        Self {
            unlocked: true,
            mfa_required: false,
            is_multi_user,
            current_username: None,
            vault,
        }
    }

    pub fn mfa_pending(vault: VaultInfo) -> Self {
        let is_multi_user = vault.is_multi_user;
        Self {
            unlocked: false,
            mfa_required: true,
            is_multi_user,
            current_username: None,
            vault,
        }
    }

    pub fn multi_user_pending(vault: VaultInfo) -> Self {
        Self {
            unlocked: false,
            mfa_required: false,
            is_multi_user: true,
            current_username: None,
            vault,
        }
    }

    pub fn complete_as_user(vault: VaultInfo, username: String) -> Self {
        Self {
            unlocked: true,
            mfa_required: false,
            is_multi_user: true,
            current_username: Some(username),
            vault,
        }
    }
}
