// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use git2::Error as Git2Error;
use serde::Serialize;

use super::debug_log::log_git2_error;

/// Structured sync failure for logging and UI toasts (`message` is user-facing).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncError {
    pub code: String,
    pub message: String,
}

impl GitSyncError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for GitSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<Git2Error> for GitSyncError {
    fn from(err: Git2Error) -> Self {
        log_git2_error("git operation", &err);
        let raw = err.message();
        Self {
            code: classify_git2_code(&err),
            message: format_git_message(raw, &err),
        }
    }
}

pub(crate) fn classify_git2_code(err: &Git2Error) -> String {
    let msg = err.message().to_lowercase();
    if msg.contains("permission denied") || msg.contains("authentication failed") {
        return "auth_failed".into();
    }
    if msg.contains("could not resolve") || msg.contains("connection") {
        return "network_error".into();
    }
    if err.code() == git2::ErrorCode::NotFound {
        return "not_found".into();
    }
    "git_error".into()
}

pub(crate) fn format_git_message(raw: &str, err: &Git2Error) -> String {
    let lower = raw.to_lowercase();

    if lower.contains("failed to authenticate ssh session") || lower.contains("auth cancelled") {
        return "SSH-Authentifizierung fehlgeschlagen: SSH-Agent prüfen, Passphrase in den Git-Sync-Einstellungen speichern oder Schlüsselpfad (.pub) kontrollieren.".into();
    }
    if lower.contains("permission denied (publickey)") {
        return "SSH-Authentifizierung fehlgeschlagen: SSH-Schlüsselpfad prüfen oder in den Git-Sync-Einstellungen konfigurieren.".into();
    }
    if lower.contains("host key verification failed") {
        return "SSH-Host-Key-Verifizierung fehlgeschlagen. Remote-Host oder Schlüssel prüfen."
            .into();
    }
    if lower.contains("could not resolve host") || lower.contains("name or service not known") {
        return "Remote-Host konnte nicht aufgelöst werden. URL und Netzwerk prüfen.".into();
    }
    if lower.contains("connection refused") || lower.contains("timed out") {
        return "Verbindung zum Git-Remote fehlgeschlagen (Timeout oder Verbindung abgelehnt)."
            .into();
    }
    if lower.contains("authentication failed")
        || lower.contains("invalid username or password")
        || lower.contains("access denied")
    {
        return "Git-Authentifizierung fehlgeschlagen. HTTPS-Benutzername oder Token prüfen."
            .into();
    }
    if lower.contains("could not read from remote repository") {
        return "Zugriff auf das Remote-Repository verweigert. Berechtigungen und Zugangsdaten prüfen.".into();
    }
    if lower.contains("not a fast-forward") || lower.contains("non-fast-forward") {
        return "Remote-Änderungen sind nicht Fast-Forward-fähig. Manueller Merge im Repository erforderlich.".into();
    }

    let _ = err;
    truncate_message(raw)
}

fn truncate_message(msg: &str) -> String {
    msg.lines()
        .find(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with("hint:")
        })
        .unwrap_or("Git-Operation fehlgeschlagen.")
        .trim()
        .trim_start_matches("fatal: ")
        .trim_start_matches("error: ")
        .chars()
        .take(240)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_ssh_auth_message() {
        let msg = format_git_message(
            "Permission denied (publickey).",
            &Git2Error::from_str("test"),
        );
        assert!(msg.contains("SSH-Authentifizierung"));
    }
}
