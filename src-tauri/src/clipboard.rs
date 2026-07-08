// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;
use tauri::Manager;
use zeroize::Zeroizing;

use crate::state::AppState;

const CLIPBOARD_CLEAR_SECONDS: u64 = 30;

pub struct SecureClipboard {
    next_id: AtomicU64,
    active: Mutex<Option<(u64, Zeroizing<String>)>>,
}

impl SecureClipboard {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            active: Mutex::new(None),
        }
    }

    pub fn copy(&self, app: &AppHandle, secret: Zeroizing<String>) -> Result<(), String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        set_clipboard_text(&mut clipboard, secret.as_str())?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        *self.active.lock().map_err(|e| e.to_string())? = Some((id, secret));

        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(CLIPBOARD_CLEAR_SECONDS));
            if let Some(state) = app.try_state::<AppState>() {
                state.clipboard.try_clear(id);
            }
        });

        Ok(())
    }

    fn try_clear(&self, id: u64) {
        let stored = {
            let mut guard = match self.active.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            match guard.as_ref() {
                Some((active_id, _)) if *active_id == id => guard.take().map(|(_, s)| s),
                _ => None,
            }
        };

        let Some(stored) = stored else {
            return;
        };

        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if clipboard.get_text().ok().as_deref() == Some(stored.as_str()) {
                let _ = set_clipboard_text(&mut clipboard, "");
            }
        }
    }

    /// Immediately clears a pending secret from the OS clipboard (if still present)
    /// and invalidates its auto-clear timer. Called on vault lock so a copied secret
    /// never outlives the session in the clipboard.
    pub fn clear_pending(&self) {
        self.next_id.fetch_add(1, Ordering::SeqCst);
        let stored = match self.active.lock() {
            Ok(mut guard) => guard.take().map(|(_, secret)| secret),
            Err(_) => return,
        };

        let Some(stored) = stored else {
            return;
        };

        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if clipboard.get_text().ok().as_deref() == Some(stored.as_str()) {
                let _ = set_clipboard_text(&mut clipboard, "");
            }
        }
    }
}

impl Default for SecureClipboard {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(windows)]
fn set_clipboard_text(clipboard: &mut arboard::Clipboard, text: &str) -> Result<(), String> {
    use arboard::SetExtWindows;

    clipboard
        .set()
        .exclude_from_history()
        .exclude_from_cloud()
        .text(text)
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn set_clipboard_text(clipboard: &mut arboard::Clipboard, text: &str) -> Result<(), String> {
    // Linux/macOS: no equivalent OS API for Windows clipboard history / cloud-sync exclusion.
    // Secret copies still use 30s auto-clear; platform asymmetry is documented in ARCHITECTURE.md §3.
    clipboard.set_text(text).map_err(|e| e.to_string())
}
