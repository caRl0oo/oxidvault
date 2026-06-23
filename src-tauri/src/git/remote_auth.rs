// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::{Path, PathBuf};

use git2::{CertificateCheckStatus, Cred, CredentialType, Error as Git2Error, RemoteCallbacks};
use zeroize::Zeroizing;

use crate::settings::GitSyncSettings;

use super::debug_log::log_git2_error;
use super::ssh_keyring::load_ssh_passphrase;

/// Credentials for in-process git2 remote operations (SSH key path and optional HTTPS basic auth).
#[derive(Clone)]
pub struct GitSyncAuth {
    pub ssh_key_path: Option<PathBuf>,
    pub https_username: Option<String>,
    pub https_password: Option<Zeroizing<String>>,
}

impl GitSyncAuth {
    pub fn from_settings(settings: &GitSyncSettings) -> Self {
        let ssh_key_path = settings
            .ssh_key_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
            .or_else(default_ssh_key_path);

        if let Some(path) = &ssh_key_path {
            log::info!("[git-auth] resolved ssh key path: {}", path.display());
        } else {
            log::warn!("[git-auth] no ssh key path configured or discovered");
        }

        let https_password = settings
            .https_password
            .as_ref()
            .filter(|value| !value.is_empty())
            .map(|value| Zeroizing::new(value.clone()));

        Self {
            ssh_key_path,
            https_username: settings
                .https_username
                .as_ref()
                .filter(|value| !value.is_empty())
                .cloned(),
            https_password,
        }
    }
}

pub fn build_remote_callbacks(auth: &GitSyncAuth) -> RemoteCallbacks<'static> {
    let ssh_key_path = auth.ssh_key_path.clone();
    let https_username = auth.https_username.clone();
    let https_password = auth.https_password.clone();

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        log::debug!(
            "[git-auth] credentials callback: url={url}, username={username_from_url:?}, allowed={allowed:?}"
        );

        if allowed.intersects(CredentialType::SSH_KEY | CredentialType::SSH_CUSTOM) {
            return authenticate_ssh(username_from_url, ssh_key_path.as_ref());
        }

        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            let username = https_username
                .as_deref()
                .or(username_from_url)
                .ok_or_else(|| auth_error("HTTPS-Benutzername für Git-Sync fehlt."))?;
            let password = https_password
                .as_ref()
                .map(|value| value.as_str())
                .unwrap_or("");
            log::debug!("[git-auth] using HTTPS userpass for user={username}");
            return Cred::userpass_plaintext(username, password);
        }

        if allowed.contains(CredentialType::DEFAULT) {
            log::debug!("[git-auth] using Cred::default()");
            return Cred::default();
        }

        log::warn!("[git-auth] unsupported credential types: {allowed:?}");
        Err(auth_error(
            "Git-Remote verlangt nicht unterstützte Anmeldedaten.",
        ))
    });
    callbacks.certificate_check(|_cert, _valid| Ok(CertificateCheckStatus::CertificateOk));
    callbacks.push_transfer_progress(|current, total, bytes| {
        if total == 0 || current == total || current % 25 == 0 {
            log::info!("[git-sync] push transfer: {current}/{total} objects, {bytes} bytes");
        }
    });
    callbacks.pack_progress(|stage, current, total| {
        if total == 0 || current == total || current % 25 == 0 {
            log::info!("[git-sync] pack build {stage:?}: {current}/{total}");
        }
    });
    callbacks.push_update_reference(|refname, status| {
        if let Some(message) = status.filter(|msg| !msg.is_empty()) {
            log::info!("[git-sync] push ref {refname}: {message}");
        }
        Ok(())
    });
    callbacks
}

fn auth_error(message: &str) -> Git2Error {
    Git2Error::from_str(message)
}

fn authenticate_ssh(
    username_from_url: Option<&str>,
    ssh_key_path: Option<&PathBuf>,
) -> Result<Cred, Git2Error> {
    let username = username_from_url.unwrap_or("git");

    // 1. SSH agent — same path as `ssh -T git@github.com` on Windows/macOS/Linux.
    match Cred::ssh_key_from_agent(username) {
        Ok(cred) => {
            log::info!("[git-auth] authenticated via ssh-agent");
            return Ok(cred);
        }
        Err(err) => {
            log::info!(
                "[git-auth] ssh-agent not used: {} (code: {:?})",
                err.message(),
                err.code()
            );
        }
    }

    let key_path = ssh_key_path.ok_or_else(|| {
        log::error!("[git-auth] no ssh-agent and no key path configured");
        auth_error(
            "SSH-Authentifizierung fehlgeschlagen: Kein SSH-Agent und kein Schlüsselpfad konfiguriert.",
        )
    })?;

    log::info!(
        "[git-auth] ssh key path={} exists={} is_file={}",
        key_path.display(),
        key_path.exists(),
        key_path.is_file()
    );

    if !key_path.is_file() {
        log::error!("[git-auth] ssh key file not found: {}", key_path.display());
        return Err(auth_error("SSH-Schlüsseldatei wurde nicht gefunden."));
    }

    let public_key_path = resolve_public_key_path(key_path);
    if let Some(public_key) = &public_key_path {
        log::info!(
            "[git-auth] public key path={} exists={}",
            public_key.display(),
            public_key.is_file()
        );
    } else {
        log::warn!(
            "[git-auth] no .pub sibling found for {}",
            key_path.display()
        );
    }

    let passphrase = load_ssh_passphrase();
    match &passphrase {
        Some(secret) => log::info!(
            "[git-auth] keyring passphrase available (length={})",
            secret.len()
        ),
        None => log::info!("[git-auth] no keyring passphrase — attempting passwordless key unlock"),
    }

    let result = Cred::ssh_key(
        username,
        public_key_path.as_deref(),
        key_path,
        passphrase.as_deref().map(|value| value.as_str()),
    );

    if let Err(ref err) = result {
        log_git2_error("Cred::ssh_key failed", err);
        if passphrase.is_none() {
            log::error!(
                "[git-auth] hint: if the key has a passphrase, save it under Settings → Git Sync → SSH Passphrase"
            );
        }
        return Err(auth_error(
            "SSH-Authentifizierung fehlgeschlagen. SSH-Agent starten, Passphrase im Keyring speichern oder passwortlosen Key nutzen.",
        ));
    }

    log::info!("[git-auth] authenticated via ssh key file");
    result
}

fn resolve_public_key_path(private_key: &Path) -> Option<PathBuf> {
    let file_name = private_key.file_name()?.to_str()?;
    let public_key = private_key.with_file_name(format!("{file_name}.pub"));
    if public_key.is_file() {
        Some(public_key)
    } else {
        None
    }
}

fn default_ssh_key_path() -> Option<PathBuf> {
    let home = user_home()?;
    let ssh_dir = home.join(".ssh");
    for name in ["id_ed25519", "id_rsa", "id_ecdsa"] {
        let candidate = ssh_dir.join(name);
        if candidate.is_file() {
            log::debug!(
                "[git-auth] default ssh key candidate: {}",
                candidate.display()
            );
            return Some(candidate);
        }
    }
    None
}

fn user_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_callbacks_without_panic() {
        let _ = build_remote_callbacks(&GitSyncAuth {
            ssh_key_path: None,
            https_username: None,
            https_password: None,
        });
    }
}
