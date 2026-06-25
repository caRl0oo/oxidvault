// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! Git-based vault directory synchronization (pull / commit / push) via `git2`.

mod debug_log;
mod errors;
pub mod git_sync;
mod remote_auth;
mod ssh_keyring;

#[allow(unused_imports)]
pub use errors::GitSyncError;
pub use git_sync::{sync_vault, GitSyncResult};
pub use remote_auth::GitSyncAuth;
pub use ssh_keyring::{remove_ssh_passphrase, save_ssh_passphrase};
