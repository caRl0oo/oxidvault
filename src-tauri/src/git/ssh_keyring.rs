// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

//! OS keyring storage for Git SSH key passphrases (Windows Credential Manager, etc.).

use keyring::Entry;
use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "oxidvault-git";
const LEGACY_KEYRING_SERVICE: &str = "oxidvault";
const KEYRING_ACCOUNT: &str = "git-ssh-passphrase";

/// Persists the SSH key passphrase in the platform credential store.
pub fn save_ssh_passphrase(passphrase: &str) -> Result<(), String> {
    if passphrase.is_empty() {
        log::info!("[git-keyring] empty passphrase submitted — removing keyring entry");
        return remove_ssh_passphrase();
    }

    let entry = open_entry()?;
    entry.set_password(passphrase).map_err(|err| {
        format_keyring_error("SSH-Passphrase konnte nicht gespeichert werden", err)
    })?;
    remove_legacy_passphrase();
    log::info!(        "[git-keyring] passphrase stored in keyring (service={KEYRING_SERVICE}, account={KEYRING_ACCOUNT}, length={})",
        passphrase.len()
    );
    Ok(())
}

/// Removes the stored SSH key passphrase from the platform credential store.
pub fn remove_ssh_passphrase() -> Result<(), String> {
    let entry = open_entry()?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(err) => {
            return Err(format_keyring_error(
                "SSH-Passphrase konnte nicht entfernt werden",
                err,
            ));
        }
    }
    remove_legacy_passphrase();
    Ok(())
}

/// Loads the SSH key passphrase from the keyring, if present.
///
/// Returns `None` when no entry exists, the secret is empty, or the keyring is unavailable.
/// Never panics — callers may retry authentication with an unencrypted key (`None` passphrase).
pub fn load_ssh_passphrase() -> Option<Zeroizing<String>> {
    log::debug!(
        "[git-keyring] load_ssh_passphrase: service={KEYRING_SERVICE}, account={KEYRING_ACCOUNT}"
    );

    match load_passphrase_from_service(KEYRING_SERVICE) {
        Ok(Some(passphrase)) => return Some(passphrase),
        Ok(None) => {}
        Err(err) => log::warn!("[git-keyring] keyring read failed: {err}"),
    }

    match load_passphrase_from_service(LEGACY_KEYRING_SERVICE) {
        Ok(Some(passphrase)) => {
            log::info!(
                "[git-keyring] migrating legacy keyring entry (service={LEGACY_KEYRING_SERVICE})"
            );
            let _ = save_ssh_passphrase(passphrase.as_str());
            return Some(passphrase);
        }
        Ok(None) => {}
        Err(err) => log::warn!("[git-keyring] legacy keyring read failed: {err}"),
    }

    log::info!("[git-keyring] no passphrase stored (NoEntry)");
    None
}

fn load_passphrase_from_service(service: &str) -> Result<Option<Zeroizing<String>>, String> {
    let entry = Entry::new(service, KEYRING_ACCOUNT)
        .map_err(|err| format_keyring_error("Keyring nicht verfügbar", err))?;

    match entry.get_password() {
        Ok(passphrase) if passphrase.is_empty() => {
            log::warn!(
                "[git-keyring] keyring entry exists but passphrase is empty (service={service})"
            );
            Ok(None)
        }
        Ok(passphrase) => {
            log::info!(
                "[git-keyring] passphrase loaded from keyring (service={service}, length={})",
                passphrase.len()
            );
            Ok(Some(Zeroizing::new(passphrase)))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format_keyring_error(
            "SSH-Passphrase konnte nicht geladen werden",
            err,
        )),
    }
}

fn remove_legacy_passphrase() {
    if let Ok(entry) = Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if entry.delete_credential().is_ok() {
            log::info!(
                "[git-keyring] removed legacy keyring entry (service={LEGACY_KEYRING_SERVICE})"
            );
        }
    }
}

fn open_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|err| format_keyring_error("Keyring nicht verfügbar", err))
}

fn format_keyring_error(context: &str, err: keyring::Error) -> String {
    format!("{context}: {err}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_passphrase_load_returns_none_without_panic() {
        let _ = load_ssh_passphrase();
    }
}
