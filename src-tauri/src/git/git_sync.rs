// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::{Path, PathBuf};

use git2::{
    FetchOptions, PushOptions, Repository, RepositoryInitOptions, Signature, StatusOptions,
};

use super::errors::GitSyncError;
use super::remote_auth::{build_remote_callbacks, GitSyncAuth};

const REMOTE_NAME: &str = "origin";
const MAIN_BRANCH: &str = "main";
const COMMIT_MESSAGE: &str = "Vault Sync";
const SYNC_IDENTITY_NAME: &str = "OxidVault";
const SYNC_IDENTITY_EMAIL: &str = "oxidvault@local";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncResult {
    pub pulled: bool,
    pub pushed: bool,
    pub message: String,
    pub vault_reloaded: bool,
}

/// Pulls remote changes, then commits and pushes local modifications when present.
/// Uses in-process `git2` — no external `git` binary required.
pub fn sync_vault(
    vault_path: &Path,
    remote_url: &str,
    auth: &GitSyncAuth,
) -> Result<GitSyncResult, GitSyncError> {
    log::info!(
        "[git-sync] sync_vault start: vault={} remote={remote_url}",
        vault_path.display()
    );

    let repo_root = resolve_repo_root(vault_path)?;
    let vault_rel = vault_relative_path(vault_path, &repo_root)?;
    log::info!(
        "[git-sync] repo_root={} vault_file={}",
        repo_root.display(),
        vault_rel.display()
    );

    let repo = open_or_init_repo(&repo_root)?;
    ensure_default_gitignore(&repo_root, &vault_rel)?;
    ensure_remote(&repo, remote_url)?;

    log::info!("[git-sync] fetch/pull starting");
    let pulled = git_pull(&repo, auth)?;
    log::info!("[git-sync] pull complete: pulled={pulled}");

    let pushed = if has_local_changes(&repo, &vault_rel)? {
        log::info!("[git-sync] local vault changes detected — commit/push starting");
        git_commit_and_push(&repo, auth, &vault_rel)?
    } else {
        log::info!("[git-sync] no local vault changes");
        false
    };
    log::info!("[git-sync] sync_vault complete: pulled={pulled} pushed={pushed}");

    let message = build_sync_message(pulled, pushed);

    Ok(GitSyncResult {
        pulled,
        pushed,
        message,
        vault_reloaded: pulled,
    })
}

fn vault_relative_path(vault_path: &Path, repo_root: &Path) -> Result<PathBuf, GitSyncError> {
    vault_path
        .strip_prefix(repo_root)
        .map(Path::to_path_buf)
        .map_err(|_| {
            GitSyncError::new(
                "invalid_path",
                "Die Vault-Datei liegt nicht im Git-Repository-Verzeichnis.",
            )
        })
}

/// Ignores everything except the vault file so repos rooted at e.g. Desktop stay fast.
fn ensure_default_gitignore(repo_root: &Path, vault_rel: &Path) -> Result<(), GitSyncError> {
    let gitignore_path = repo_root.join(".gitignore");
    if gitignore_path.exists() {
        return Ok(());
    }

    let vault_name = vault_rel
        .to_str()
        .ok_or_else(|| GitSyncError::new("invalid_path", "Ungültiger Vault-Dateiname."))?;
    let content = format!("*\n!{vault_name}\n!.gitignore\n");
    std::fs::write(&gitignore_path, content).map_err(|err| {
        GitSyncError::new(
            "io_error",
            format!("`.gitignore` konnte nicht geschrieben werden: {err}"),
        )
    })?;
    log::info!("[git-sync] created default .gitignore for vault file `{vault_name}`");
    Ok(())
}

fn resolve_repo_root(vault_path: &Path) -> Result<PathBuf, GitSyncError> {
    let vault_dir = vault_path
        .parent()
        .ok_or_else(|| GitSyncError::new("invalid_path", "Ungültiger Vault-Pfad."))?;

    if let Ok(repo) = Repository::discover(vault_dir) {
        let root = repo
            .workdir()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| vault_dir.to_path_buf());
        return Ok(root);
    }

    Ok(vault_dir.to_path_buf())
}

fn open_or_init_repo(repo_root: &Path) -> Result<Repository, GitSyncError> {
    if repo_root.join(".git").exists() {
        return Repository::open(repo_root).map_err(GitSyncError::from);
    }

    let mut init_opts = RepositoryInitOptions::new();
    init_opts.initial_head(MAIN_BRANCH);
    Repository::init_opts(repo_root, &init_opts).map_err(GitSyncError::from)
}

fn ensure_remote(repo: &Repository, url: &str) -> Result<(), GitSyncError> {
    match repo.find_remote(REMOTE_NAME) {
        Ok(_) => {
            repo.remote_set_url(REMOTE_NAME, url)
                .map_err(GitSyncError::from)?;
        }
        Err(_) => {
            repo.remote(REMOTE_NAME, url).map_err(GitSyncError::from)?;
        }
    }
    Ok(())
}

fn git_pull(repo: &Repository, auth: &GitSyncAuth) -> Result<bool, GitSyncError> {
    let mut remote = repo.find_remote(REMOTE_NAME).map_err(GitSyncError::from)?;

    let refspec = format!("refs/heads/{MAIN_BRANCH}:refs/remotes/{REMOTE_NAME}/{MAIN_BRANCH}");
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(build_remote_callbacks(auth));

    if let Err(err) = remote.fetch(&[refspec.as_str()], Some(&mut fetch_options), None) {
        if is_benign_fetch_error(&err) {
            return Ok(false);
        }
        return Err(GitSyncError::from(err));
    }

    let fetch_ref = format!("refs/remotes/{REMOTE_NAME}/{MAIN_BRANCH}");
    let remote_ref = match repo.find_reference(&fetch_ref) {
        Ok(reference) => reference,
        Err(err) if is_benign_fetch_error(&err) => return Ok(false),
        Err(err) => return Err(GitSyncError::from(err)),
    };

    let annotated = repo
        .reference_to_annotated_commit(&remote_ref)
        .map_err(GitSyncError::from)?;

    if let Ok(head) = repo.head() {
        if let Ok(head_commit) = head.peel_to_commit() {
            if head_commit.id() == annotated.id() {
                return Ok(false);
            }
        }
    }

    if repo
        .find_reference(&format!("refs/heads/{MAIN_BRANCH}"))
        .is_ok()
    {
        fast_forward_main(repo, &annotated)?;
    } else {
        repo.branch(MAIN_BRANCH, &repo.find_commit(annotated.id())?, false)
            .map_err(GitSyncError::from)?;
        repo.set_head(&format!("refs/heads/{MAIN_BRANCH}"))
            .map_err(GitSyncError::from)?;
        repo.checkout_head(Some(&mut default_checkout_options()))
            .map_err(GitSyncError::from)?;
    }

    Ok(true)
}

fn fast_forward_main(
    repo: &Repository,
    annotated: &git2::AnnotatedCommit,
) -> Result<(), GitSyncError> {
    let (analysis, _) = repo
        .merge_analysis(&[annotated])
        .map_err(GitSyncError::from)?;

    if analysis.is_up_to_date() {
        return Ok(());
    }
    if !analysis.is_fast_forward() {
        return Err(GitSyncError::new(
            "ff_rejected",
            "Remote-Änderungen sind nicht Fast-Forward-fähig.",
        ));
    }

    let mut branch = repo
        .find_reference(&format!("refs/heads/{MAIN_BRANCH}"))
        .map_err(GitSyncError::from)?;
    branch
        .set_target(annotated.id(), "Fast-forward")
        .map_err(GitSyncError::from)?;
    repo.set_head(branch.name().unwrap_or("refs/heads/main"))
        .map_err(GitSyncError::from)?;
    repo.checkout_head(Some(&mut default_checkout_options()))
        .map_err(GitSyncError::from)?;
    Ok(())
}

fn default_checkout_options() -> git2::build::CheckoutBuilder<'static> {
    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force();
    builder
}

fn is_benign_fetch_error(err: &git2::Error) -> bool {
    let lower = err.message().to_lowercase();
    lower.contains("couldn't find remote ref")
        || lower.contains("not found")
        || lower.contains("no such remote")
        || lower.contains("remote ref does not exist")
        || err.code() == git2::ErrorCode::NotFound
}

fn has_local_changes(repo: &Repository, vault_rel: &Path) -> Result<bool, GitSyncError> {
    let pathspec = vault_pathspec(vault_rel)?;
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .pathspec(&pathspec);

    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(GitSyncError::from)?;
    Ok(!statuses.is_empty())
}

fn git_commit_and_push(
    repo: &Repository,
    auth: &GitSyncAuth,
    vault_rel: &Path,
) -> Result<bool, GitSyncError> {
    ensure_main_branch(repo)?;

    let mut index = repo.index().map_err(GitSyncError::from)?;
    index.add_path(vault_rel).map_err(GitSyncError::from)?;
    index.write().map_err(GitSyncError::from)?;

    let tree_id = index.write_tree().map_err(GitSyncError::from)?;
    let tree = repo.find_tree(tree_id).map_err(GitSyncError::from)?;
    let signature =
        Signature::now(SYNC_IDENTITY_NAME, SYNC_IDENTITY_EMAIL).map_err(GitSyncError::from)?;

    let parents = collect_parent_commits(repo)?;
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();

    let main_ref = format!("refs/heads/{MAIN_BRANCH}");
    let commit_oid = repo
        .commit(
            Some(main_ref.as_str()),
            &signature,
            &signature,
            COMMIT_MESSAGE,
            &tree,
            &parent_refs,
        )
        .map_err(GitSyncError::from)?;
    log::info!("[git-sync] commit on {MAIN_BRANCH}: {commit_oid}");

    verify_push_fast_forward(repo)?;

    let mut remote = repo.find_remote(REMOTE_NAME).map_err(GitSyncError::from)?;
    let refspec = format!("refs/heads/{MAIN_BRANCH}:refs/heads/{MAIN_BRANCH}");
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(build_remote_callbacks(auth));
    log::info!("[git-sync] push starting (refspec={refspec})");
    remote
        .push(&[refspec.as_str()], Some(&mut push_options))
        .map_err(GitSyncError::from)?;
    log::info!("[git-sync] push complete");

    Ok(true)
}

fn ensure_main_branch(repo: &Repository) -> Result<(), GitSyncError> {
    let main_ref = format!("refs/heads/{MAIN_BRANCH}");
    if repo.find_reference(&main_ref).is_ok() {
        return repo.set_head(&main_ref).map_err(GitSyncError::from);
    }

    for legacy in ["refs/heads/master", "HEAD"] {
        if let Ok(reference) = repo.find_reference(legacy) {
            if let Ok(commit) = reference.peel_to_commit() {
                repo.branch(MAIN_BRANCH, &commit, false)
                    .map_err(GitSyncError::from)?;
                return repo.set_head(&main_ref).map_err(GitSyncError::from);
            }
        }
    }

    repo.set_head(&main_ref).map_err(GitSyncError::from)
}

fn verify_push_fast_forward(repo: &Repository) -> Result<(), GitSyncError> {
    let local_oid = repo.head()?.peel_to_commit()?.id();
    let remote_ref_name = format!("refs/remotes/{REMOTE_NAME}/{MAIN_BRANCH}");
    let remote_oid = match repo.find_reference(&remote_ref_name) {
        Ok(reference) => reference.peel_to_commit()?.id(),
        Err(_) => return Ok(()),
    };

    if local_oid == remote_oid {
        return Ok(());
    }

    let fast_forward = repo
        .graph_descendant_of(local_oid, remote_oid)
        .unwrap_or(false);
    if !fast_forward {
        return Err(GitSyncError::new(
            "ff_rejected",
            "Remote-Branch hat abweichende Historie (z. B. README auf GitHub). \
             Vault in einen eigenen Ordner legen oder das lokale `.git`-Verzeichnis bereinigen.",
        ));
    }
    Ok(())
}

fn vault_pathspec(vault_rel: &Path) -> Result<String, GitSyncError> {
    vault_rel
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| GitSyncError::new("invalid_path", "Ungültiger Vault-Pfad."))
}

fn collect_parent_commits(repo: &Repository) -> Result<Vec<git2::Commit<'_>>, GitSyncError> {
    let mut parents = Vec::new();
    if let Ok(head) = repo.head() {
        if let Ok(commit) = head.peel_to_commit() {
            parents.push(commit);
        }
    }
    Ok(parents)
}

fn build_sync_message(pulled: bool, pushed: bool) -> String {
    match (pulled, pushed) {
        (true, true) => "Remote-Änderungen geholt und lokale Änderungen hochgeladen.".into(),
        (true, false) => "Remote-Änderungen geholt — keine lokalen Änderungen.".into(),
        (false, true) => "Lokale Änderungen hochgeladen.".into(),
        (false, false) => "Bereits synchron — keine Änderungen.".into(),
    }
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
    fn benign_fetch_errors() {
        let err = git2::Error::from_str("couldn't find remote ref main");
        assert!(is_benign_fetch_error(&err));
    }
}
