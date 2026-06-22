// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! Enterprise compliance status for policy, audit chain, and key rotation age.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::audit::{audit_log_path, verify_audit_chain};
use crate::error::VaultError;
use crate::format::{self, VaultFileMeta, FORMAT_VERSION_V1};
use crate::policy::admin_policy_active;

pub const KEY_ROTATION_THRESHOLD_DAYS: u64 = 90;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceStatus {
    pub policy_managed_by_gpo: bool,
    pub audit_chain_valid: bool,
    pub key_created_at: Option<String>,
    pub key_rotated_at: Option<String>,
    pub key_age_days: u32,
    pub key_rotation_recommended: bool,
}

pub fn compliance_status(vault_path: &Path) -> Result<ComplianceStatus, VaultError> {
    let meta = format::read_vault_meta(vault_path)?;
    let log_path = audit_log_path(vault_path);
    let audit_chain_valid = if log_path.is_file() {
        verify_audit_chain(&log_path).is_ok()
    } else {
        true
    };

    let reference_ts = key_reference_timestamp(&meta, vault_path);
    let key_age_days = age_days_from_unix(reference_ts);
    let key_rotation_recommended = u64::from(key_age_days) > KEY_ROTATION_THRESHOLD_DAYS;

    Ok(ComplianceStatus {
        policy_managed_by_gpo: admin_policy_active(),
        audit_chain_valid,
        key_created_at: iso_from_unix(meta.key_created_at),
        key_rotated_at: iso_from_unix(meta.key_rotated_at),
        key_age_days,
        key_rotation_recommended,
    })
}

fn key_reference_timestamp(meta: &VaultFileMeta, vault_path: &Path) -> u64 {
    if meta.key_rotated_at > 0 {
        return meta.key_rotated_at;
    }
    if meta.key_created_at > 0 {
        return meta.key_created_at;
    }
    if meta.format_version == FORMAT_VERSION_V1 {
        return file_modified_unix(vault_path).unwrap_or(0);
    }
    0
}

fn file_modified_unix(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

fn age_days_from_unix(reference_ts: u64) -> u32 {
    if reference_ts == 0 {
        return 0;
    }
    let now = unix_timestamp_secs();
    (now.saturating_sub(reference_ts) / 86_400) as u32
}

pub fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn iso_from_unix(timestamp: u64) -> Option<String> {
    if timestamp == 0 {
        return None;
    }
    Some(timestamp_to_rfc3339(timestamp))
}

fn timestamp_to_rfc3339(timestamp: u64) -> String {
    use chrono::{TimeZone, Utc};
    Utc.timestamp_opt(timestamp as i64, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| timestamp.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::{AuditAction, AuditLogger};
    use crate::crypto::{random_salt, KdfParams, MasterKey};
    use crate::format::write_vault_file_v1;
    use tempfile::tempdir;

    #[test]
    fn compliance_status_reports_valid_chain() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let salt = random_salt();
        let kdf = KdfParams::default();
        let key = MasterKey::derive_from_password("pw", &salt, kdf).unwrap();
        write_vault_file_v1(&path, "Vault", kdf, &salt, &key, &[]).unwrap();

        let logger = AuditLogger::for_vault(&path).unwrap();
        logger.log(AuditAction::VaultCreated).expect("log");

        let status = compliance_status(&path).expect("status");
        assert!(status.audit_chain_valid);
    }
}
