// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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
    fs::write(path, raw).map_err(|e| e.to_string())
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
