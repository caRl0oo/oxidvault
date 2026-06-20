use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;
use tauri::Manager;
use zeroize::Zeroizing;

use crate::commands::AppState;

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
        clipboard
            .set_text(secret.as_str())
            .map_err(|e| e.to_string())?;

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
                let _ = clipboard.set_text("");
            }
        }
    }

    pub fn cancel_pending(&self) {
        self.next_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
    }
}

impl Default for SecureClipboard {
    fn default() -> Self {
        Self::new()
    }
}
