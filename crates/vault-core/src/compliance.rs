// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Enterprise compliance status for policy, audit chain, and key rotation age.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::audit::{
    audit_log_has_checkpoints, audit_log_path, verify_audit_chain, verify_audit_chain_keyed,
    AUDIT_NO_CHECKPOINTS,
};
use crate::error::VaultError;
use crate::format::{self, VaultFileMeta};
use crate::policy::admin_policy_active;

pub const KEY_ROTATION_THRESHOLD_DAYS: u64 = 90;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceStatus {
    pub policy_managed_by_gpo: bool,
    pub audit_chain_valid: bool,
    pub audit_chain_authenticated: Option<bool>,
    pub audit_authentication_status: Option<String>,
    pub key_created_at: Option<String>,
    pub key_rotated_at: Option<String>,
    pub key_age_days: u32,
    pub key_rotation_recommended: bool,
    pub vault_format_version: u16,
}

pub fn compliance_status(
    vault_path: &Path,
    format_version: u16,
    audit_hmac_key: Option<&[u8]>,
    checkpoints_applicable: bool,
) -> Result<ComplianceStatus, VaultError> {
    let meta = format::read_vault_meta(vault_path)?;
    compliance_status_with_meta(
        vault_path,
        &meta,
        format_version,
        audit_hmac_key,
        checkpoints_applicable,
    )
}

pub fn compliance_status_with_meta(
    vault_path: &Path,
    meta: &VaultFileMeta,
    format_version: u16,
    audit_hmac_key: Option<&[u8]>,
    checkpoints_applicable: bool,
) -> Result<ComplianceStatus, VaultError> {
    let log_path = audit_log_path(vault_path);
    let audit_chain_valid = if log_path.is_file() {
        verify_audit_chain(&log_path).is_ok()
    } else {
        true
    };

    let (audit_chain_authenticated, audit_authentication_status) =
        evaluate_audit_authentication(&log_path, checkpoints_applicable, audit_hmac_key);

    let reference_ts = key_reference_timestamp(meta);
    let key_age_days = age_days_from_unix(reference_ts);
    let key_rotation_recommended = u64::from(key_age_days) > KEY_ROTATION_THRESHOLD_DAYS;

    Ok(ComplianceStatus {
        policy_managed_by_gpo: admin_policy_active(),
        audit_chain_valid,
        audit_chain_authenticated,
        audit_authentication_status,
        key_created_at: iso_from_unix(meta.key_created_at),
        key_rotated_at: iso_from_unix(meta.key_rotated_at),
        key_age_days,
        key_rotation_recommended,
        vault_format_version: format_version,
    })
}

fn evaluate_audit_authentication(
    log_path: &Path,
    checkpoints_applicable: bool,
    audit_hmac_key: Option<&[u8]>,
) -> (Option<bool>, Option<String>) {
    if !checkpoints_applicable {
        return (None, None);
    }

    let Some(key) = audit_hmac_key else {
        return (Some(false), Some(AUDIT_NO_CHECKPOINTS.into()));
    };

    if !log_path.is_file() || !audit_log_has_checkpoints(log_path) {
        return (Some(false), Some(AUDIT_NO_CHECKPOINTS.into()));
    }

    match verify_audit_chain_keyed(log_path, key) {
        Ok(()) => (Some(true), Some("ok".into())),
        Err(VaultError::Other(ref message)) if message == AUDIT_NO_CHECKPOINTS => {
            (Some(false), Some(AUDIT_NO_CHECKPOINTS.into()))
        }
        Err(_) => (Some(false), Some("audit_chain_invalid".into())),
    }
}

fn key_reference_timestamp(meta: &VaultFileMeta) -> u64 {
    if meta.key_rotated_at > 0 {
        return meta.key_rotated_at;
    }
    meta.key_created_at
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
    use crate::vault_user::{build_vault_user, UserRole};
    use tempfile::tempdir;
    use zeroize::Zeroizing;

    #[test]
    fn compliance_status_reports_valid_chain() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = crate::crypto::MasterKey::generate_data_key();
        let user = build_vault_user("admin", password, UserRole::Admin, &dek, None).unwrap();
        format::write_v3_vault_file(&path, "Vault", &[user], dek.as_bytes(), &[]).unwrap();

        let logger = AuditLogger::for_vault(&path).unwrap();
        logger.log(AuditAction::VaultCreated).expect("log");

        let status =
            compliance_status(&path, format::FORMAT_VERSION_V4, None, true).expect("status");
        assert!(status.audit_chain_valid);
        assert_eq!(status.audit_chain_authenticated, Some(false));
        assert_eq!(
            status.audit_authentication_status.as_deref(),
            Some(AUDIT_NO_CHECKPOINTS)
        );
        assert_eq!(status.vault_format_version, format::FORMAT_VERSION_V4);
    }
}
