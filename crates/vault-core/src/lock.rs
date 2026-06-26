// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! Exclusive vault file lock — one writer per `.oxid` file (local + UNC shares).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::error::VaultError;

/// Metadata stored in `{vault}.lock` when a process holds exclusive access.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockMetadata {
    pub user: String,
    pub pid: u32,
    pub host: String,
}

impl LockMetadata {
    /// Stable audit reference for the active vault file lock (metadata-only).
    pub fn lock_id(&self) -> String {
        format!("{}@{}:{}", self.user, self.host, self.pid)
    }
}

impl std::fmt::Display for LockMetadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (pid {}) on {}", self.user, self.pid, self.host)
    }
}

/// Exclusive lock bound to a vault file path (`{vault}.lock` beside `{vault}.oxid`).
#[derive(Debug)]
pub struct VaultLock {
    lock_path: PathBuf,
    acquired: bool,
}

impl VaultLock {
    pub fn new(vault_path: &Path) -> Self {
        Self {
            lock_path: lock_path_for(vault_path),
            acquired: false,
        }
    }

    /// Acquires the lock atomically via `create_new`. Repairs stale locks when the holder PID
    /// is no longer running on the same host.
    pub fn acquire(&mut self) -> Result<(), VaultError> {
        self.try_acquire(true)
    }

    /// Releases the lock file if this instance holds it.
    pub fn release(&mut self) -> Result<(), VaultError> {
        if self.acquired {
            if self.lock_path.is_file() {
                fs::remove_file(&self.lock_path)?;
            }
            self.acquired = false;
        }
        Ok(())
    }

    pub fn is_acquired(&self) -> bool {
        self.acquired
    }

    pub fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    /// Verifies this instance still holds the on-disk lock file for the current process.
    pub fn assert_held(&self) -> Result<LockMetadata, VaultError> {
        if !self.acquired {
            return Err(VaultError::LockLost);
        }

        if !self.lock_path.is_file() {
            return Err(VaultError::LockLost);
        }

        let metadata = read_lock_metadata(&self.lock_path)?;
        if !holder_matches_current_process(&metadata) {
            return Err(VaultError::LockLost);
        }

        Ok(metadata)
    }

    fn try_acquire(&mut self, allow_stale_repair: bool) -> Result<(), VaultError> {
        match create_lock_file(&self.lock_path, &current_lock_metadata()) {
            Ok(()) => {
                self.acquired = true;
                Ok(())
            }
            Err(VaultError::Io(err)) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing = read_lock_metadata(&self.lock_path)?;
                if allow_stale_repair && is_stale_lock(&existing) {
                    let _ = fs::remove_file(&self.lock_path);
                    return self.try_acquire(false);
                }
                Err(VaultError::LockedBy(existing))
            }
            Err(err) => Err(err),
        }
    }
}

impl Drop for VaultLock {
    fn drop(&mut self) {
        let _ = self.release();
    }
}

pub fn lock_path_for(vault_path: &Path) -> PathBuf {
    vault_path.with_extension("lock")
}

/// Ensures the current process may write the vault file (held lock or matching lock metadata).
pub(crate) fn assert_vault_write_access(
    vault_path: &Path,
    held_lock: Option<&VaultLock>,
) -> Result<(), VaultError> {
    if let Some(lock) = held_lock {
        lock.assert_held()?;
        return Ok(());
    }

    let lock_path = lock_path_for(vault_path);
    if !lock_path.is_file() {
        return Ok(());
    }

    let metadata = read_lock_metadata(&lock_path)?;
    if holder_matches_current_process(&metadata) {
        return Ok(());
    }

    Err(VaultError::LockedBy(metadata))
}

fn create_lock_file(path: &Path, metadata: &LockMetadata) -> Result<(), VaultError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;

    let json = serde_json::to_string_pretty(metadata)
        .map_err(|err| VaultError::Other(format!("failed to serialize lock metadata: {err}")))?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

fn read_lock_metadata(path: &Path) -> Result<LockMetadata, VaultError> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw)
        .map_err(|err| VaultError::Other(format!("invalid vault lock file {path:?}: {err}")))
}

fn is_stale_lock(metadata: &LockMetadata) -> bool {
    if metadata.host != current_host() {
        return false;
    }

    if metadata.pid == std::process::id() {
        return false;
    }

    !process_is_running(metadata.pid)
}

fn process_is_running(pid: u32) -> bool {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), false);
    system.process(pid).is_some()
}

fn holder_matches_current_process(metadata: &LockMetadata) -> bool {
    let current = current_lock_metadata();
    metadata.pid == current.pid && metadata.host == current.host && metadata.user == current.user
}

fn current_lock_metadata() -> LockMetadata {
    LockMetadata {
        user: current_user(),
        pid: std::process::id(),
        host: current_host(),
    }
}

fn current_user() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".into())
}

fn current_host() -> String {
    System::host_name().unwrap_or_else(|| "unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn acquire_and_release_lock() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path().join("team.oxid");

        let mut lock = VaultLock::new(&vault_path);
        lock.acquire().expect("acquire lock");
        assert!(lock.lock_path().is_file());
        assert!(lock.is_acquired());

        lock.release().expect("release lock");
        assert!(!lock.is_acquired());
        assert!(!lock.lock_path().is_file());
    }

    #[test]
    fn second_acquire_returns_locked_by() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path().join("team.oxid");

        let mut first = VaultLock::new(&vault_path);
        first.acquire().expect("first acquire");

        let mut second = VaultLock::new(&vault_path);
        let err = second.acquire().expect_err("second acquire must fail");
        match err {
            VaultError::LockedBy(meta) => {
                assert_eq!(meta.pid, std::process::id());
                assert_eq!(meta.user, current_user());
            }
            other => panic!("expected LockedBy, got {other:?}"),
        }
    }

    #[test]
    fn stale_lock_is_repaired_when_pid_is_dead() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path().join("team.oxid");
        let lock_path = lock_path_for(&vault_path);

        let stale = LockMetadata {
            user: "ghost".into(),
            pid: 9_999_999,
            host: current_host(),
        };
        create_lock_file(&lock_path, &stale).expect("seed stale lock");

        let mut lock = VaultLock::new(&vault_path);
        lock.acquire().expect("stale lock repair");
        assert!(lock.is_acquired());

        let meta = read_lock_metadata(&lock_path).expect("read lock metadata");
        assert_eq!(meta.pid, std::process::id());
    }

    #[test]
    fn assert_held_fails_when_lock_file_is_removed() {
        let dir = tempdir().expect("tempdir");
        let vault_path = dir.path().join("team.oxid");

        let mut lock = VaultLock::new(&vault_path);
        lock.acquire().expect("acquire lock");
        fs::remove_file(lock.lock_path()).expect("remove lock file");

        let err = lock.assert_held().expect_err("lock file missing");
        assert!(matches!(err, VaultError::LockLost));
    }

    #[test]
    fn lock_path_replaces_oxid_extension() {
        let path = PathBuf::from(r"\\fileserver\team\vault.oxid");
        assert_eq!(
            lock_path_for(&path),
            PathBuf::from(r"\\fileserver\team\vault.lock")
        );
    }
}
