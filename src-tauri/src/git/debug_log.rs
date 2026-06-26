// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Development logging helpers for git2 / keyring diagnostics.

use git2::Error as Git2Error;

/// Logs a libgit2 error plus `Error::last_error()` when present (console during `tauri dev`).
pub(crate) fn log_git2_error(context: &str, err: &Git2Error) {
    log::error!(
        "[git-sync] {context}: {} (code: {:?}, class: {:?})",
        err.message(),
        err.code(),
        err.class()
    );
    if let Some(last) = Git2Error::last_error(err.raw_code()) {
        log::error!("[git-sync] libgit2 last_error: {}", last.message());
    }
}
