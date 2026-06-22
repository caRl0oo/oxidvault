// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::{Path, PathBuf};
use std::process::Command;

const REMOTE_NAME: &str = "origin";
const COMMIT_MESSAGE: &str = "Vault Sync";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncResult {
    pub pulled: bool,
    pub pushed: bool,
    pub message: String,
    pub vault_reloaded: bool,
}

/// Pulls remote changes, then commits and pushes local modifications when present.
/// Operates only on the vault directory — no secret data leaves the process.
pub fn sync_vault(vault_path: &Path, remote_url: &str) -> Result<GitSyncResult, String> {
    let repo_root = resolve_repo_root(vault_path)?;
    ensure_git_repo(&repo_root)?;
    ensure_remote(&repo_root, remote_url)?;

    let pulled = git_pull(&repo_root)?;
    let pushed = if git_has_local_changes(&repo_root)? {
        git_commit_and_push(&repo_root)?
    } else {
        false
    };

    let message = build_sync_message(pulled, pushed);

    Ok(GitSyncResult {
        pulled,
        pushed,
        message,
        vault_reloaded: pulled,
    })
}

fn resolve_repo_root(vault_path: &Path) -> Result<PathBuf, String> {
    let vault_dir = vault_path
        .parent()
        .ok_or_else(|| "Ungültiger Vault-Pfad.".to_string())?;

    if let Ok(root) = run_git(vault_dir, &["rev-parse", "--show-toplevel"]) {
        return Ok(PathBuf::from(root.trim()));
    }

    Ok(vault_dir.to_path_buf())
}

fn ensure_git_repo(repo: &Path) -> Result<(), String> {
    if repo.join(".git").exists() {
        return Ok(());
    }
    run_git(repo, &["init", "-b", "main"])?;
    Ok(())
}

fn ensure_remote(repo: &Path, url: &str) -> Result<(), String> {
    let remotes = run_git(repo, &["remote"]).unwrap_or_default();
    if remotes.lines().any(|name| name.trim() == REMOTE_NAME) {
        run_git(repo, &["remote", "set-url", REMOTE_NAME, url])?;
    } else {
        run_git(repo, &["remote", "add", REMOTE_NAME, url])?;
    }
    Ok(())
}

fn git_pull(repo: &Path) -> Result<bool, String> {
    match run_git(repo, &["pull", "--ff-only", REMOTE_NAME]) {
        Ok(_) => Ok(true),
        Err(err) => {
            if is_benign_pull_error(&err) {
                Ok(false)
            } else {
                Err(err)
            }
        }
    }
}

fn is_benign_pull_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("no tracking information")
        || lower.contains("couldn't find remote ref")
        || lower.contains("does not appear to be a git repository")
        || lower.contains("could not read from remote") && lower.contains("empty")
        || lower.contains("fatal: not a git repository")
        || lower.contains("no commits yet")
        || lower.contains("refspec") && lower.contains("not found")
}

fn git_has_local_changes(repo: &Path) -> Result<bool, String> {
    let status = run_git(repo, &["status", "--porcelain"])?;
    Ok(!status.trim().is_empty())
}

fn git_commit_and_push(repo: &Path) -> Result<bool, String> {
    run_git(repo, &["add", "-A"])?;
    let status = run_git(repo, &["status", "--porcelain"])?;
    if status.trim().is_empty() {
        return Ok(false);
    }
    run_git(repo, &["commit", "-m", COMMIT_MESSAGE])?;
    if run_git(repo, &["push", REMOTE_NAME, "HEAD"]).is_err() {
        run_git(repo, &["push", "-u", REMOTE_NAME, "HEAD"])?;
    }
    Ok(true)
}

fn build_sync_message(pulled: bool, pushed: bool) -> String {
    match (pulled, pushed) {
        (true, true) => "Remote-Änderungen geholt und lokale Änderungen hochgeladen.".into(),
        (true, false) => "Remote-Änderungen geholt — keine lokalen Änderungen.".into(),
        (false, true) => "Lokale Änderungen hochgeladen.".into(),
        (false, false) => "Bereits synchron — keine Änderungen.".into(),
    }
}

fn run_git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|_| "Git ist nicht installiert oder nicht im PATH.".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        let msg = if stderr.is_empty() { stdout } else { stderr };
        Err(truncate_git_error(&msg))
    }
}

fn truncate_git_error(msg: &str) -> String {
    msg.lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Git-Operation fehlgeschlagen.")
        .chars()
        .take(200)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_message_variants() {
        assert!(build_sync_message(true, true).contains("geholt"));
        assert!(build_sync_message(false, false).contains("synchron"));
    }

    #[test]
    fn benign_pull_errors() {
        assert!(is_benign_pull_error(
            "There is no tracking information for the current branch."
        ));
        assert!(!is_benign_pull_error(
            "fatal: unable to access 'https://github.com/': Could not resolve host"
        ));
    }
}
