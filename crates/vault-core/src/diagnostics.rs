// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

//! Admin system diagnostics for support and IT overview (no secrets).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::audit::{audit_log_path, verify_audit_chain};
use crate::audit_secure::secure_audit_log_file;
use crate::error::VaultError;
use crate::policy::{admin_policy_path, load_admin_policy};

/// Stable status code — mapped to i18n keys in the frontend (`diagnostics.statusCodes.*`).
pub type DiagnosticStatusCode = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPathDiagnostics {
    pub loaded_path: Option<String>,
    pub stored_path: Option<String>,
    pub is_network_path: bool,
    pub ok: bool,
    pub status: DiagnosticStatusCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDiagnostics {
    pub path: String,
    pub active: bool,
    pub ok: bool,
    pub status: DiagnosticStatusCode,
    pub policy_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogDiagnostics {
    pub path: Option<String>,
    pub ok: bool,
    pub status: DiagnosticStatusCode,
    pub chain_valid: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDiagnostics {
    pub version: String,
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnostics {
    pub vault_path: VaultPathDiagnostics,
    pub policy_status: PolicyDiagnostics,
    pub audit_log_status: AuditLogDiagnostics,
    pub version_info: VersionDiagnostics,
}

pub fn collect_system_diagnostics(
    loaded_vault_path: Option<&str>,
    stored_vault_path: Option<&str>,
) -> SystemDiagnostics {
    let effective_path = loaded_vault_path.or(stored_vault_path);
    SystemDiagnostics {
        vault_path: diagnose_vault_path(loaded_vault_path, stored_vault_path),
        policy_status: diagnose_policy(),
        audit_log_status: diagnose_audit_log(effective_path),
        version_info: VersionDiagnostics {
            version: crate::VAULT_VERSION.to_string(),
            ok: true,
        },
    }
}

fn diagnose_vault_path(
    loaded: Option<&str>,
    stored: Option<&str>,
) -> VaultPathDiagnostics {
    let candidate = loaded.or(stored);
    let Some(path_str) = candidate else {
        return VaultPathDiagnostics {
            loaded_path: loaded.map(str::to_string),
            stored_path: stored.map(str::to_string),
            is_network_path: false,
            ok: false,
            status: "vault_not_loaded".into(),
        };
    };

    let path = PathBuf::from(path_str);
    let is_network_path = is_network_path_str(path_str);

    if !path.is_file() {
        return VaultPathDiagnostics {
            loaded_path: loaded.map(str::to_string),
            stored_path: stored.map(str::to_string),
            is_network_path,
            ok: false,
            status: "vault_file_not_found".into(),
        };
    }

    if OpenOptions::new().read(true).open(&path).is_err() {
        return VaultPathDiagnostics {
            loaded_path: loaded.map(str::to_string),
            stored_path: stored.map(str::to_string),
            is_network_path,
            ok: false,
            status: "vault_path_not_reachable".into(),
        };
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !is_directory_writable(parent) {
            return VaultPathDiagnostics {
                loaded_path: loaded.map(str::to_string),
                stored_path: stored.map(str::to_string),
                is_network_path,
                ok: false,
                status: "vault_dir_not_writable".into(),
            };
        }
    }

    VaultPathDiagnostics {
        loaded_path: loaded.map(str::to_string),
        stored_path: stored.map(str::to_string),
        is_network_path,
        ok: true,
        status: "ok".into(),
    }
}

fn diagnose_policy() -> PolicyDiagnostics {
    let path = admin_policy_path();
    let path_display = path.display().to_string();
    let active = path.is_file();

    if !active {
        return PolicyDiagnostics {
            path: path_display,
            active: false,
            ok: true,
            status: "policy_not_configured".into(),
            policy_hash: None,
        };
    }

    let policy_hash = policy_file_sha256(&path);

    match load_admin_policy() {
        Ok(Some(_)) => PolicyDiagnostics {
            path: path_display,
            active: true,
            ok: true,
            status: "ok".into(),
            policy_hash,
        },
        Ok(None) => PolicyDiagnostics {
            path: path_display,
            active: false,
            ok: true,
            status: "policy_not_configured".into(),
            policy_hash: None,
        },
        Err(VaultError::Other(msg)) if msg.contains("invalid admin policy") => PolicyDiagnostics {
            path: path_display,
            active: true,
            ok: false,
            status: "policy_invalid".into(),
            policy_hash,
        },
        Err(_) => PolicyDiagnostics {
            path: path_display,
            active: true,
            ok: false,
            status: "policy_not_readable".into(),
            policy_hash,
        },
    }
}

fn diagnose_audit_log(vault_path: Option<&str>) -> AuditLogDiagnostics {
    let Some(vault_path) = vault_path else {
        return AuditLogDiagnostics {
            path: None,
            ok: false,
            status: "audit_no_vault".into(),
            chain_valid: None,
        };
    };

    let log_path = audit_log_path(Path::new(vault_path));
    let path_display = log_path.display().to_string();

    if secure_audit_log_file(&log_path).is_err() {
        return AuditLogDiagnostics {
            path: Some(path_display),
            ok: false,
            status: "audit_not_writable".into(),
            chain_valid: None,
        };
    }

    let writable = OpenOptions::new()
        .append(true)
        .open(&log_path)
        .and_then(|mut file| file.flush())
        .is_ok();

    if !writable {
        return AuditLogDiagnostics {
            path: Some(path_display),
            ok: false,
            status: "audit_not_writable".into(),
            chain_valid: None,
        };
    }

    let chain_valid = if log_path.is_file() {
        Some(verify_audit_chain(&log_path).is_ok())
    } else {
        None
    };

    if chain_valid == Some(false) {
        return AuditLogDiagnostics {
            path: Some(path_display),
            ok: false,
            status: "audit_chain_invalid".into(),
            chain_valid,
        };
    }

    AuditLogDiagnostics {
        path: Some(path_display),
        ok: true,
        status: if log_path.is_file() {
            "ok".into()
        } else {
            "audit_not_present".into()
        },
        chain_valid,
    }
}

fn is_network_path_str(path: &str) -> bool {
    let normalized = path.replace('/', "\\");
    normalized.starts_with("\\\\")
}

fn is_directory_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".oxidvault-write-probe-{}", std::process::id()));
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn policy_file_sha256(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(sha256_hex(&Sha256::digest(bytes)))
}

fn sha256_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::{AuditAction, AuditLogger};
    use crate::crypto::{random_salt, KdfParams, MasterKey};
    use crate::format::write_vault_file_v1;
    use tempfile::tempdir;

    #[test]
    fn diagnostics_ok_for_local_vault() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("team.oxid");
        let salt = random_salt();
        let kdf = KdfParams::default();
        let key = MasterKey::derive_from_password("pw", &salt, kdf).expect("key");
        write_vault_file_v1(&path, "Vault", kdf, &salt, &key, &[]).expect("write");

        let logger = AuditLogger::for_vault(&path).expect("logger");
        logger
            .log(AuditAction::VaultCreated, None)
            .expect("audit log");

        let path_str = path.display().to_string();
        let report = collect_system_diagnostics(Some(&path_str), None);

        assert!(report.vault_path.ok);
        assert_eq!(report.vault_path.status, "ok");
        assert!(report.audit_log_status.ok);
        assert_eq!(report.version_info.version, crate::VAULT_VERSION);
    }

    #[test]
    fn diagnostics_detects_missing_vault_file() {
        let report = collect_system_diagnostics(
            Some("/nonexistent/path/vault.oxid"),
            None,
        );
        assert!(!report.vault_path.ok);
        assert_eq!(report.vault_path.status, "vault_file_not_found");
    }

    #[test]
    fn detects_unc_paths() {
        assert!(is_network_path_str(r"\\server\share\vault.oxid"));
        assert!(!is_network_path_str(r"C:\vault.oxid"));
    }
}
