// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use vault_core::os_protect::{self, FileProtectionProfile};

const APP_IDENTIFIER: &str = "com.oxidvault.app";
const SESSION_FILE: &str = "native_messaging_session.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub port: u16,
    pub token: String,
}

pub fn app_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join(APP_IDENTIFIER))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
            .map(|base| base.join(APP_IDENTIFIER))
    }
}

fn session_path() -> Option<PathBuf> {
    #[cfg(test)]
    if let Ok(dir) = std::env::var("OXIDVAULT_TEST_SESSION_DIR") {
        return Some(PathBuf::from(dir).join(SESSION_FILE));
    }
    app_data_dir().map(|dir| dir.join(SESSION_FILE))
}

pub fn write_session(port: u16, token: &str) -> Result<(), String> {
    let path = session_path().ok_or_else(|| "app data directory not found".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let info = SessionInfo {
        port,
        token: token.to_string(),
    };
    let raw = serde_json::to_string(&info).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    os_protect::secure_file(&path, FileProtectionProfile::OwnerOnly).map_err(|e| e.to_string())
}

pub fn read_session() -> Option<SessionInfo> {
    let path = session_path()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn remove_session() {
    if let Some(path) = session_path() {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
pub fn session_file_path() -> Option<PathBuf> {
    session_path()
}

#[cfg(test)]
pub struct TestSessionEnv {
    _guard: std::sync::MutexGuard<'static, ()>,
    _dir: tempfile::TempDir,
}

#[cfg(test)]
impl Drop for TestSessionEnv {
    fn drop(&mut self) {
        remove_session();
        std::env::remove_var("OXIDVAULT_TEST_SESSION_DIR");
    }
}

/// Isolated NM session directory for tests (empty — no session file until written).
///
/// Serializes via [`test_env_lock`] so parallel tests do not read the real
/// `%APPDATA%/com.oxidvault.app/native_messaging_session.json`.
#[cfg(test)]
pub fn test_env() -> TestSessionEnv {
    let guard = test_env_lock();
    let dir = tempfile::tempdir().expect("tempdir");
    std::env::set_var("OXIDVAULT_TEST_SESSION_DIR", dir.path());
    TestSessionEnv {
        _guard: guard,
        _dir: dir,
    }
}

#[cfg(test)]
pub fn test_env_lock() -> std::sync::MutexGuard<'static, ()> {
    use std::sync::Mutex;
    static ENV_MUTEX: Mutex<()> = Mutex::new(());
    ENV_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
