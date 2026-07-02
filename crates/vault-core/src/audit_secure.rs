// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! OS-level access control for `{vault}.audit.log` files (ISO 27001).

use std::path::Path;

use crate::error::VaultError;
use crate::os_protect::{self, FileProtectionProfile};

/// Creates the audit log if missing and restricts access to the vault owner (and Administrators on Windows).
pub fn secure_audit_log_file(path: &Path) -> Result<(), VaultError> {
    os_protect::secure_file(path, FileProtectionProfile::OwnerAndAdministrators)
}

/// Verifies that the platform can enforce audit-log file permissions.
pub fn verify_platform_audit_security(path: &Path) -> Result<(), VaultError> {
    os_protect::verify_file_security(path, FileProtectionProfile::OwnerAndAdministrators)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn secure_audit_log_file_sets_restrictive_permissions() {
        let dir = tempdir().expect("tempdir");
        let log_path = dir.path().join("team.audit.log");

        secure_audit_log_file(&log_path).expect("secure audit log");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&log_path)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        verify_platform_audit_security(&log_path).expect("verify permissions");
    }
}
