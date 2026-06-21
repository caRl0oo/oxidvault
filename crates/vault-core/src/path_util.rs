//! Vault path normalization — including UNC network shares on Windows.

use std::path::{Path, PathBuf};

use crate::error::VaultError;

/// Normalizes a vault file path for filesystem operations.
///
/// Trims whitespace and preserves UNC prefixes such as `\\server\share\vault.oxid`.
pub fn normalize_vault_path(path: impl AsRef<Path>) -> Result<PathBuf, VaultError> {
    let raw = path.as_ref().to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(VaultError::Other("vault path is empty".into()));
    }

    #[cfg(windows)]
    {
        Ok(normalize_windows_vault_path(trimmed))
    }

    #[cfg(not(windows))]
    {
        Ok(PathBuf::from(trimmed))
    }
}

#[cfg(windows)]
fn normalize_windows_vault_path(path: &str) -> PathBuf {
    let mut normalized = path.replace('/', "\\");

    if normalized.starts_with("\\\\") {
        return PathBuf::from(normalized);
    }

    if let Some(stripped) = normalized.strip_prefix("//") {
        normalized = format!("\\\\{stripped}");
        return PathBuf::from(normalized);
    }

    PathBuf::from(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_path() {
        let err = normalize_vault_path("   ").expect_err("empty path");
        assert!(err.to_string().contains("empty"));
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let path = normalize_vault_path("  /tmp/vault.oxid  ").unwrap();
        assert_eq!(path, PathBuf::from("/tmp/vault.oxid"));
    }

    #[cfg(windows)]
    #[test]
    fn preserves_unc_prefix() {
        let path = normalize_vault_path(r"\\fileserver\team\vault.oxid").unwrap();
        assert_eq!(path, PathBuf::from(r"\\fileserver\team\vault.oxid"));
    }

    #[cfg(windows)]
    #[test]
    fn normalizes_forward_slash_unc() {
        let path = normalize_vault_path("//fileserver/team/vault.oxid").unwrap();
        assert_eq!(path, PathBuf::from(r"\\fileserver\team\vault.oxid"));
    }

    #[cfg(windows)]
    #[test]
    fn unc_parent_directory() {
        let path = PathBuf::from(r"\\fileserver\team\vault.oxid");
        assert_eq!(
            path.parent(),
            Some(Path::new(r"\\fileserver\team"))
        );
    }
}
