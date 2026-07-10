// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! ISO 27001 compliance audit log — metadata-only, append-only, hash-chained.
//!
//! This module never accepts secret values. Only [`AuditAction`] variants and non-sensitive
//! reference tokens (UUIDs, config area names, sync status labels) are recorded.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

const AUDIT_HKDF_INFO: &[u8] = b"oxidvault-audit-v1";
pub const AUDIT_CHECKPOINT_INTERVAL: u32 = 50;

use crate::audit_secure;
use crate::crypto::MasterKey;
use crate::error::VaultError;
use crate::vault_user::UserRole;

pub use audit_secure::secure_audit_log_file;

const MAX_DETAIL_TOKEN_LEN: usize = 120;

/// Metadata-only security events — no variant carries passwords, usernames, or secret payloads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditAction {
    VaultCreated,
    VaultOpened,
    VaultUnlocked {
        lock_id: String,
    },
    VaultLocked,
    /// Legacy log label — superseded by [`Self::SecretCreated`] for new writes.
    EntryCreated,
    /// Legacy log label — superseded by [`Self::SecretModified`] for new writes.
    EntryUpdated,
    SecretCreated {
        id: Uuid,
    },
    SecretModified {
        id: Uuid,
    },
    EntryDeleted {
        id: Uuid,
    },
    SecretCopied {
        id: Uuid,
    },
    SecretRevealed {
        id: Uuid,
    },
    /// Browser extension autofill served a web-login secret (entry UUID only).
    SecretAutofilled {
        id: Uuid,
    },
    /// Native-messaging bridge `get_login` rate limit exceeded.
    BridgeThrottled,
    VaultKeyRotated,
    /// Failed vault unlock attempt (wrong master password).
    AuthFailed,
    SyncEvent {
        status: String,
    },
    ConfigChanged {
        area: String,
    },
    /// SSH host key fingerprint was trusted and persisted for an entry.
    SshHostTrusted {
        id: Uuid,
    },
    UserAdded {
        username: String,
    },
    UserRemoved {
        username: String,
    },
    UserPasswordChanged {
        username: String,
    },
    UserRoleChanged {
        username: String,
        new_role: UserRole,
    },
    UserMfaEnabled {
        username: String,
    },
    UserMfaDisabled {
        username: String,
    },
    VaultMigratedToV3 {
        admin_username: String,
    },
    /// HMAC-signed chain anchor (v2+ vaults, unlocked session only).
    Checkpoint,
}

impl AuditAction {
    pub fn action_name(&self) -> &'static str {
        match self {
            Self::VaultCreated => "VaultCreated",
            Self::VaultOpened => "VaultOpened",
            Self::VaultUnlocked { .. } => "VaultUnlocked",
            Self::VaultLocked => "VaultLocked",
            Self::EntryCreated => "EntryCreated",
            Self::EntryUpdated => "EntryUpdated",
            Self::SecretCreated { .. } => "SecretCreated",
            Self::SecretModified { .. } => "SecretModified",
            Self::EntryDeleted { .. } => "EntryDeleted",
            Self::SecretCopied { .. } => "SecretCopied",
            Self::SecretRevealed { .. } => "SecretRevealed",
            Self::SecretAutofilled { .. } => "SecretAutofilled",
            Self::BridgeThrottled => "BridgeThrottled",
            Self::VaultKeyRotated => "VaultKeyRotated",
            Self::AuthFailed => "AuthFailed",
            Self::SyncEvent { .. } => "SyncEvent",
            Self::ConfigChanged { .. } => "ConfigChanged",
            Self::SshHostTrusted { .. } => "SshHostTrusted",
            Self::UserAdded { .. } => "UserAdded",
            Self::UserRemoved { .. } => "UserRemoved",
            Self::UserPasswordChanged { .. } => "UserPasswordChanged",
            Self::UserRoleChanged { .. } => "UserRoleChanged",
            Self::UserMfaEnabled { .. } => "UserMfaEnabled",
            Self::UserMfaDisabled { .. } => "UserMfaDisabled",
            Self::VaultMigratedToV3 { .. } => "VaultMigratedToV3",
            Self::Checkpoint => "Checkpoint",
        }
    }

    fn detail_token(&self) -> String {
        match self {
            Self::VaultCreated
            | Self::VaultOpened
            | Self::VaultLocked
            | Self::VaultKeyRotated
            | Self::AuthFailed
            | Self::EntryCreated
            | Self::EntryUpdated => "-".to_string(),
            Self::BridgeThrottled => "-".to_string(),
            Self::VaultUnlocked { lock_id } => sanitize_detail_token(lock_id),
            Self::SecretCreated { id }
            | Self::SecretModified { id }
            | Self::EntryDeleted { id }
            | Self::SecretCopied { id }
            | Self::SecretRevealed { id }
            | Self::SecretAutofilled { id }
            | Self::SshHostTrusted { id } => id.to_string(),
            Self::SyncEvent { status } => sanitize_detail_token(status),
            Self::ConfigChanged { area } => sanitize_detail_token(area),
            Self::UserAdded { username }
            | Self::UserRemoved { username }
            | Self::UserPasswordChanged { username }
            | Self::UserMfaEnabled { username }
            | Self::UserMfaDisabled { username }
            | Self::VaultMigratedToV3 {
                admin_username: username,
            } => sanitize_detail_token(username),
            Self::Checkpoint => "-".to_string(),
            Self::UserRoleChanged { username, new_role } => {
                let role = match new_role {
                    UserRole::Member => "member",
                    UserRole::Admin => "admin",
                };
                sanitize_detail_token(&format!("{username}:{role}"))
            }
        }
    }

    /// Parses a persisted action label back into an [`AuditAction`] shell for display/export.
    ///
    /// Structured fields are reconstructed from the third log bracket when possible.
    pub fn from_log_parts(action: &str, entry_id: &str) -> Self {
        match action {
            "VaultUnlocked" => Self::VaultUnlocked {
                lock_id: entry_id.to_string(),
            },
            "SecretCreated" | "EntryCreated" => {
                parse_uuid_action(entry_id, |id| Self::SecretCreated { id })
            }
            "SecretModified" | "EntryUpdated" => {
                parse_uuid_action(entry_id, |id| Self::SecretModified { id })
            }
            "EntryDeleted" => parse_uuid_action(entry_id, |id| Self::EntryDeleted { id }),
            "SecretCopied" => parse_uuid_action(entry_id, |id| Self::SecretCopied { id }),
            "SecretRevealed" => parse_uuid_action(entry_id, |id| Self::SecretRevealed { id }),
            "SecretAutofilled" => parse_uuid_action(entry_id, |id| Self::SecretAutofilled { id }),
            "BridgeThrottled" => Self::BridgeThrottled,
            "SshHostTrusted" => parse_uuid_action(entry_id, |id| Self::SshHostTrusted { id }),
            "SyncEvent" => Self::SyncEvent {
                status: entry_id.to_string(),
            },
            "ConfigChanged" => Self::ConfigChanged {
                area: entry_id.to_string(),
            },
            "AuthFailed" => Self::AuthFailed,
            "VaultCreated" => Self::VaultCreated,
            "VaultOpened" => Self::VaultOpened,
            "VaultLocked" => Self::VaultLocked,
            "VaultKeyRotated" => Self::VaultKeyRotated,
            "UserAdded" => Self::UserAdded {
                username: entry_id.to_string(),
            },
            "UserRemoved" => Self::UserRemoved {
                username: entry_id.to_string(),
            },
            "UserPasswordChanged" => Self::UserPasswordChanged {
                username: entry_id.to_string(),
            },
            "UserMfaEnabled" => Self::UserMfaEnabled {
                username: entry_id.to_string(),
            },
            "UserMfaDisabled" => Self::UserMfaDisabled {
                username: entry_id.to_string(),
            },
            "VaultMigratedToV3" => Self::VaultMigratedToV3 {
                admin_username: entry_id.to_string(),
            },
            "Checkpoint" => Self::Checkpoint,
            "UserRoleChanged" => {
                let (username, role) = entry_id.split_once(':').unwrap_or((entry_id, "member"));
                let new_role = if role == "admin" {
                    UserRole::Admin
                } else {
                    UserRole::Member
                };
                Self::UserRoleChanged {
                    username: username.to_string(),
                    new_role,
                }
            }
            other => Self::ConfigChanged {
                area: sanitize_detail_token(other),
            },
        }
    }
}

fn parse_uuid_action<F>(entry_id: &str, build: F) -> AuditAction
where
    F: FnOnce(Uuid) -> AuditAction,
{
    if entry_id == "-" || entry_id.trim().is_empty() {
        return AuditAction::EntryCreated;
    }
    match Uuid::parse_str(entry_id.trim()) {
        Ok(id) => build(id),
        Err(_) => AuditAction::ConfigChanged {
            area: sanitize_detail_token(entry_id),
        },
    }
}

fn sanitize_detail_token(value: &str) -> String {
    let trimmed: String = value
        .chars()
        .filter(|ch| !ch.is_control())
        .take(MAX_DETAIL_TOKEN_LEN)
        .collect();
    if trimmed.trim().is_empty() {
        "-".to_string()
    } else {
        trimmed.trim().to_string()
    }
}

/// Trait for append-only compliance logging from [`crate::vault::Vault`].
pub trait AuditLog {
    fn log(&self, action: AuditAction) -> Result<(), VaultError>;
}

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
pub const AUDIT_NO_CHECKPOINTS: &str = "audit_no_checkpoints";

/// Derives the per-vault audit HMAC key from the shared DEK (stable across user password rewraps).
pub fn derive_audit_hmac_key(dek: &MasterKey) -> Zeroizing<[u8; 32]> {
    use hkdf::Hkdf;

    let hkdf = Hkdf::<Sha256>::new(None, dek.as_bytes());
    let mut key = Zeroizing::new([0u8; 32]);
    hkdf.expand(AUDIT_HKDF_INFO, key.as_mut())
        .expect("HKDF expand to 32 bytes");
    key
}

fn compute_checkpoint_hmac(hmac_key: &[u8; 32], entry_hash: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(hmac_key).expect("HMAC accepts 32-byte keys");
    mac.update(entry_hash.as_bytes());
    hex_encode(&mac.finalize().into_bytes())
}

/// Append-only, hash-chained audit logger bound to a vault file path.
#[derive(Debug)]
pub struct AuditLogger {
    path: Option<PathBuf>,
    last_hash: Mutex<String>,
}

impl AuditLogger {
    pub fn disabled() -> Self {
        Self {
            path: None,
            last_hash: Mutex::new(GENESIS_HASH.to_string()),
        }
    }

    /// Opens or creates `{vault}.audit.log` next to the `.oxid` vault file.
    pub fn for_vault(vault_path: &Path) -> Result<Self, VaultError> {
        let path = audit_log_path(vault_path);
        secure_audit_log_file(&path)?;
        let last_hash = read_last_entry_hash(&path)?;
        Ok(Self {
            path: Some(path),
            last_hash: Mutex::new(last_hash),
        })
    }

    fn build_record(timestamp: &str, action: &str, entry_id: &str, prev_hash: &str) -> String {
        format!(
            "[{timestamp}] [{action}] [{entry_id}] prev_hash={prev_hash}",
            timestamp = timestamp,
            action = action,
            entry_id = entry_id,
            prev_hash = prev_hash,
        )
    }

    fn compute_hash(record: &str) -> String {
        let digest = Sha256::digest(record.as_bytes());
        hex_encode(&digest)
    }

    fn append_line(&self, line: &str) -> Result<(), VaultError> {
        let path = self
            .path
            .as_ref()
            .ok_or_else(|| VaultError::Other("audit log not configured".into()))?;

        let mut file = OpenOptions::new().create(true).append(true).open(path)?;

        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        file.flush()?;
        Ok(())
    }

    /// Records an HMAC-signed checkpoint (v2+ unlocked sessions).
    pub fn log_checkpoint(&self, hmac_key: &[u8]) -> Result<(), VaultError> {
        if hmac_key.len() != 32 {
            return Err(VaultError::Other("audit HMAC key must be 32 bytes".into()));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(hmac_key);
        if self.path.is_none() {
            return Ok(());
        }

        let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let mut last_hash = self
            .last_hash
            .lock()
            .map_err(|_| VaultError::Other("audit logger lock poisoned".into()))?;

        let record = Self::build_record(&timestamp, "Checkpoint", "-", &last_hash);
        let entry_hash = Self::compute_hash(&record);
        let hmac = compute_checkpoint_hmac(&key, &entry_hash);
        let line = format!("{record} entry_hash={entry_hash} hmac={hmac}");

        self.append_line(&line)?;
        *last_hash = entry_hash;
        Ok(())
    }

    /// Records a metadata-only audit event (no secrets).
    pub fn log(&self, action: AuditAction) -> Result<(), VaultError> {
        if self.path.is_none() {
            return Ok(());
        }

        let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let action_name = action.action_name();
        let entry_token = action.detail_token();

        let mut last_hash = self
            .last_hash
            .lock()
            .map_err(|_| VaultError::Other("audit logger lock poisoned".into()))?;

        let record = Self::build_record(&timestamp, action_name, &entry_token, &last_hash);
        let entry_hash = Self::compute_hash(&record);
        let line = format!("{record} entry_hash={entry_hash}");

        self.append_line(&line)?;
        *last_hash = entry_hash;
        Ok(())
    }
}

impl AuditLog for AuditLogger {
    fn log(&self, action: AuditAction) -> Result<(), VaultError> {
        AuditLogger::log(self, action)
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::disabled()
    }
}

/// Appends a single audit event to `{vault}.audit.log` without holding a live vault session.
pub fn log_event_for_vault(vault_path: &Path, action: AuditAction) -> Result<(), VaultError> {
    let logger = AuditLogger::for_vault(vault_path)?;
    logger.log(action)
}

pub fn audit_log_path(vault_path: &Path) -> PathBuf {
    vault_path.with_extension("audit.log")
}

/// Parsed compliance audit log row (metadata-only — no secrets).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub timestamp_utc: String,
    pub action: String,
    pub entry_id: String,
    pub entry_hash: String,
}

/// Reads the newest audit log entries for a vault file (newest first).
pub fn read_audit_logs(vault_path: &Path, limit: usize) -> Result<Vec<AuditLogEntry>, VaultError> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let log_path = audit_log_path(vault_path);
    if !log_path.is_file() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&log_path)?;
    let mut entries: Vec<AuditLogEntry> =
        content.lines().filter_map(parse_audit_log_line).collect();

    if entries.len() > limit {
        entries = entries.split_off(entries.len().saturating_sub(limit));
    }
    entries.reverse();
    Ok(entries)
}

fn parse_audit_log_line(line: &str) -> Option<AuditLogEntry> {
    let parsed = parse_audit_line(line).ok()?;
    Some(AuditLogEntry {
        timestamp_utc: parsed.timestamp_utc,
        action: parsed.action,
        entry_id: parsed.entry_id,
        entry_hash: parsed.entry_hash,
    })
}

/// Parsed audit log line including hash-chain fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAuditLine {
    pub timestamp_utc: String,
    pub action: String,
    pub entry_id: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

/// Parses a single audit log line (metadata + hash chain; optional `hmac=` suffix tolerated).
pub fn parse_audit_line(line: &str) -> Result<ParsedAuditLine, VaultError> {
    let line = line.trim();
    if line.is_empty() {
        return Err(VaultError::AuditLogCorrupted);
    }

    let entry_hash = parse_entry_hash(line).ok_or(VaultError::AuditLogCorrupted)?;
    let record = line
        .rsplit_once(" entry_hash=")
        .map(|(prefix, _)| prefix)
        .ok_or(VaultError::AuditLogCorrupted)?;

    let timestamp = parse_bracket_field(record, 0).ok_or(VaultError::AuditLogCorrupted)?;
    let action = parse_bracket_field(record, 1).ok_or(VaultError::AuditLogCorrupted)?;
    let entry_id = parse_bracket_field(record, 2).ok_or(VaultError::AuditLogCorrupted)?;
    let prev_hash = parse_prev_hash(record).ok_or(VaultError::AuditLogCorrupted)?;

    Ok(ParsedAuditLine {
        timestamp_utc: timestamp.to_string(),
        action: action.to_string(),
        entry_id: entry_id.to_string(),
        prev_hash,
        entry_hash,
    })
}

fn parse_prev_hash(record: &str) -> Option<String> {
    record
        .rsplit_once("prev_hash=")
        .map(|(_, hash)| hash.trim().to_string())
        .filter(|hash| hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
}

fn parse_bracket_field(line: &str, index: usize) -> Option<&str> {
    let mut rest = line.trim();
    for i in 0..=index {
        rest = rest.strip_prefix('[')?;
        let (value, remaining) = rest.split_once(']')?;
        rest = remaining.trim();
        if i == index {
            return Some(value);
        }
    }
    None
}

/// Validates OS-level audit-log protection and aborts startup if compliance cannot be enforced.
///
/// Creates a temporary probe file, applies platform ACLs/permissions, verifies them, and removes
/// the probe. Per-vault `{vault}.audit.log` files are secured again in [`AuditLogger::for_vault`].
pub fn init() -> Result<(), VaultError> {
    let probe_path =
        std::env::temp_dir().join(format!("oxidvault-audit-init-{}.log", std::process::id()));

    audit_secure::verify_platform_audit_security(&probe_path)?;

    if probe_path.is_file() {
        std::fs::remove_file(&probe_path)?;
    }

    Ok(())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn read_last_entry_hash(path: &Path) -> Result<String, VaultError> {
    if !path.is_file() {
        return Ok(GENESIS_HASH.to_string());
    }

    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(GENESIS_HASH.to_string());
    }

    let tail_size = len.min(4096);
    file.seek(SeekFrom::End(-(tail_size as i64)))?;
    let mut buffer = vec![0u8; tail_size as usize];
    file.read_exact(&mut buffer)?;

    let text = String::from_utf8_lossy(&buffer);
    let last_line = text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| VaultError::Other("audit log contains no parseable lines".into()))?;

    parse_entry_hash(last_line)
        .ok_or_else(|| VaultError::Other(format!("audit log line missing entry_hash: {last_line}")))
}

fn parse_entry_hash(line: &str) -> Option<String> {
    let tail = line.rsplit_once(" entry_hash=")?.1;
    let hash = tail.split_whitespace().next()?;
    (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_string())
}

fn parse_checkpoint_hmac(line: &str) -> Option<String> {
    let tail = line.rsplit_once(" hmac=")?.1;
    let hmac = tail.trim();
    (hmac.len() == 64 && hmac.chars().all(|c| c.is_ascii_hexdigit())).then(|| hmac.to_string())
}

/// Returns whether the audit log contains at least one [`Checkpoint`] line.
pub fn audit_log_has_checkpoints(path: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(path) else {
        return false;
    };
    content
        .lines()
        .any(|line| line.contains("[Checkpoint]") && line.contains(" hmac="))
}

/// Verifies the hash chain of an audit log file (integrity check).
pub fn verify_audit_chain(path: &Path) -> Result<(), VaultError> {
    let content = std::fs::read_to_string(path)?;
    let mut prev_hash = GENESIS_HASH.to_string();

    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let entry_hash = parse_entry_hash(line)
            .ok_or_else(|| VaultError::Other(format!("malformed audit log line: {line}")))?;

        let record = line
            .rsplit_once(" entry_hash=")
            .map(|(prefix, _)| prefix)
            .ok_or_else(|| VaultError::Other(format!("malformed audit log line: {line}")))?;

        if !record.contains(&format!("prev_hash={prev_hash}")) {
            return Err(VaultError::AuditLogCorrupted);
        }

        let expected = AuditLogger::compute_hash(record);
        if expected != entry_hash {
            return Err(VaultError::AuditLogCorrupted);
        }

        prev_hash = entry_hash;
    }

    Ok(())
}

/// Verifies checkpoint HMACs in addition to the structural hash chain.
///
/// Returns `Err(VaultError::Other(AUDIT_NO_CHECKPOINTS))` when no checkpoint lines exist.
pub fn verify_audit_chain_keyed(path: &Path, hmac_key: &[u8]) -> Result<(), VaultError> {
    if hmac_key.len() != 32 {
        return Err(VaultError::Other("audit HMAC key must be 32 bytes".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(hmac_key);
    verify_audit_chain(path)?;

    if !audit_log_has_checkpoints(path) {
        return Err(VaultError::Other(AUDIT_NO_CHECKPOINTS.into()));
    }

    let content = std::fs::read_to_string(path)?;
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        if !line.contains("[Checkpoint]") {
            continue;
        }
        let entry_hash = parse_entry_hash(line)
            .ok_or_else(|| VaultError::Other(format!("malformed checkpoint line: {line}")))?;
        let hmac = parse_checkpoint_hmac(line)
            .ok_or_else(|| VaultError::Other(format!("checkpoint missing hmac: {line}")))?;
        let expected = compute_checkpoint_hmac(&key, &entry_hash);
        if expected != hmac {
            return Err(VaultError::AuditLogCorrupted);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultError;
    use tempfile::tempdir;

    #[test]
    fn init_succeeds_on_platform() {
        init().expect("platform supports audit log security");
    }

    #[test]
    fn log_format_and_chain() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger
            .log(AuditAction::VaultUnlocked {
                lock_id: "lock-1".into(),
            })
            .expect("log unlock");
        let entry_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        logger
            .log(AuditAction::SecretCreated { id: entry_id })
            .expect("log create");

        let log_path = audit_log_path(&vault_path);
        let raw = std::fs::read_to_string(log_path).unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("[VaultUnlocked]"));
        assert!(lines[0].contains("[lock-1]"));
        assert!(lines[0].contains(&format!("prev_hash={GENESIS_HASH}")));
        assert!(lines[1].contains("[SecretCreated]"));
        assert!(lines[1].contains("[550e8400-e29b-41d4-a716-446655440000]"));
        assert!(lines[1].contains("prev_hash="));
        assert!(!lines[1].contains(&format!("prev_hash={GENESIS_HASH}")));

        verify_audit_chain(&audit_log_path(&vault_path)).expect("valid chain");
    }

    #[test]
    fn read_audit_logs_newest_first_with_limit() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        for i in 0..5 {
            logger
                .log(AuditAction::SecretCreated {
                    id: Uuid::parse_str(&format!("550e8400-e29b-41d4-a716-44665544000{i}"))
                        .unwrap(),
                })
                .expect("log");
        }

        let all = read_audit_logs(&vault_path, 10).expect("read");
        assert_eq!(all.len(), 5);
        assert!(all[0].entry_id.contains('4'));
        assert!(all[4].entry_id.contains('0'));

        let limited = read_audit_logs(&vault_path, 2).expect("read limited");
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn read_audit_logs_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("missing.oxid");
        let entries = read_audit_logs(&vault_path, 10).expect("read");
        assert!(entries.is_empty());
    }

    #[test]
    fn disabled_logger_is_noop() {
        let logger = AuditLogger::disabled();
        logger.log(AuditAction::VaultLocked).expect("noop log");
    }

    #[test]
    fn tampered_chain_fails_verification() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("vault.oxid");
        std::fs::write(&vault_path, b"x").unwrap();
        let log_path = audit_log_path(&vault_path);

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger.log(AuditAction::VaultOpened).unwrap();

        let mut content = std::fs::read_to_string(&log_path).unwrap();
        content = content.replace("[VaultOpened]", "[VaultUnlocked]");
        std::fs::write(&log_path, content).unwrap();

        let err = verify_audit_chain(&log_path).expect_err("tampered chain");
        assert!(matches!(err, VaultError::AuditLogCorrupted));
    }

    #[test]
    fn auth_failed_and_sync_event_tokens() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();
        let logger = AuditLogger::for_vault(&vault_path).unwrap();

        logger.log(AuditAction::AuthFailed).expect("auth failed");
        logger
            .log(AuditAction::SyncEvent {
                status: "success".into(),
            })
            .expect("sync");
        logger
            .log(AuditAction::ConfigChanged {
                area: "git_sync".into(),
            })
            .expect("config");

        let entries = read_audit_logs(&vault_path, 10).expect("read");
        assert_eq!(entries[0].action, "ConfigChanged");
        assert_eq!(entries[1].action, "SyncEvent");
        assert_eq!(entries[2].action, "AuthFailed");
    }

    #[test]
    fn from_log_parts_maps_legacy_entry_created() {
        let action =
            AuditAction::from_log_parts("EntryCreated", "550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(
            action,
            AuditAction::SecretCreated { id } if id.to_string() == "550e8400-e29b-41d4-a716-446655440000"
        ));
    }

    fn forged_log_without_hmac(path: &Path) -> String {
        let content = std::fs::read_to_string(path).unwrap();
        let mut prev_hash = GENESIS_HASH.to_string();
        let mut forged = String::new();
        for line in content.lines().filter(|line| !line.trim().is_empty()) {
            let record = line
                .rsplit_once(" entry_hash=")
                .map(|(prefix, _)| prefix)
                .unwrap();
            let entry_hash = AuditLogger::compute_hash(record);
            forged.push_str(&format!("{record} entry_hash={entry_hash}\n"));
            prev_hash = entry_hash;
        }
        let _ = prev_hash;
        forged
    }

    #[test]
    fn forged_rewrite_passes_structural_fails_keyed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("forge.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let vault = crate::vault::Vault::create_v3(&path, "ForgeVault", "admin", password).unwrap();
        vault
            .record_audit(AuditAction::SecretCreated {
                id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            })
            .unwrap();

        let log_path = audit_log_path(&path);
        let key = vault
            .audit_session_hmac_key()
            .expect("audit key after create");
        verify_audit_chain_keyed(&log_path, key).expect("keyed ok");

        std::fs::write(&log_path, forged_log_without_hmac(&log_path)).unwrap();
        verify_audit_chain(&log_path).expect("structural still valid");
        let err = verify_audit_chain_keyed(&log_path, key).unwrap_err();
        assert!(matches!(
            err,
            VaultError::Other(ref message) if message == AUDIT_NO_CHECKPOINTS
        ));
    }

    #[test]
    fn truncate_after_checkpoint_fails_keyed_verification() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("truncate.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let vault =
            crate::vault::Vault::create_v3(&path, "TruncateVault", "admin", password).unwrap();
        vault.record_audit(AuditAction::VaultOpened).unwrap();

        let log_path = audit_log_path(&path);
        let key = vault.audit_session_hmac_key().expect("key");
        verify_audit_chain_keyed(&log_path, key).expect("initial ok");

        let content = std::fs::read(&log_path).unwrap();
        let truncate_at = content.len() / 2;
        std::fs::write(&log_path, &content[..truncate_at]).unwrap();

        assert!(verify_audit_chain(&log_path).is_err());
        assert!(verify_audit_chain_keyed(&log_path, key).is_err());
    }

    #[test]
    fn audit_chain_survives_key_rotation_export_path() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rotate-export.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let mut vault =
            crate::vault::Vault::create_v3(&path, "ExportVault", "admin", password).unwrap();
        vault
            .reencrypt_vault("correct-horse-battery-staple", "rotation-export-test-pw")
            .unwrap();
        let log_path = audit_log_path(&path);
        verify_audit_chain(&log_path).expect("structural after rotation");
        let key = vault.audit_session_hmac_key().expect("key");
        verify_audit_chain_keyed(&log_path, key).expect("keyed after rotation");
    }

    #[test]
    fn happy_path_many_entries_passes_both_verifiers() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("many.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let vault = crate::vault::Vault::create_v3(&path, "ManyVault", "admin", password).unwrap();

        for i in 0..120 {
            vault
                .record_audit(AuditAction::SecretCreated {
                    id: Uuid::parse_str(&format!("550e8400-e29b-41d4-a716-44665544{i:04x}"))
                        .unwrap(),
                })
                .unwrap();
        }

        let log_path = audit_log_path(&path);
        let key = vault.audit_session_hmac_key().expect("key");
        verify_audit_chain(&log_path).expect("structural");
        verify_audit_chain_keyed(&log_path, key).expect("keyed");
        assert!(audit_log_has_checkpoints(&log_path));
    }

    #[test]
    fn two_users_derive_identical_audit_hmac_key() {
        use crate::crypto::MasterKey;
        use crate::vault_user::{build_vault_user, unwrap_user_dek, UserRole};
        use zeroize::Zeroizing;

        let dek = MasterKey::generate_data_key();
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let member_password = Zeroizing::new("another-strong-password-1".to_string());
        let admin =
            build_vault_user("admin", admin_password.clone(), UserRole::Admin, &dek, None).unwrap();
        let member = build_vault_user(
            "member",
            member_password.clone(),
            UserRole::Member,
            &dek,
            None,
        )
        .unwrap();

        let admin_kek =
            crate::vault_user::derive_user_kek(&admin, admin_password.as_str()).unwrap();
        let member_kek =
            crate::vault_user::derive_user_kek(&member, member_password.as_str()).unwrap();
        let admin_dek = unwrap_user_dek(&admin, &admin_kek).unwrap();
        let member_dek = unwrap_user_dek(&member, &member_kek).unwrap();

        let key_a = derive_audit_hmac_key(&admin_dek);
        let key_b = derive_audit_hmac_key(&member_dek);
        assert_eq!(key_a.as_ref(), key_b.as_ref());
    }

    #[test]
    fn v4_vault_attach_only_writes_no_checkpoints() {
        use crate::compliance::compliance_status;
        use crate::crypto::MasterKey;
        use crate::format::{write_v3_vault_file, FORMAT_VERSION_V4};
        use crate::vault::Vault;
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("v4.oxid");
        let dek = MasterKey::generate_data_key();
        let admin = build_vault_user(
            "admin",
            Zeroizing::new("correct-horse-battery-staple".to_string()),
            UserRole::Admin,
            &dek,
            None,
        )
        .unwrap();
        write_v3_vault_file(&path, "V4Vault", &[admin], dek.as_bytes(), &[]).unwrap();

        let mut vault = Vault::new();
        vault.attach_locked(&path).unwrap();

        let log_path = audit_log_path(&path);
        assert!(!audit_log_has_checkpoints(&log_path));
        assert!(vault.audit_session_hmac_key().is_none());

        let status = compliance_status(&path, FORMAT_VERSION_V4, None, true).unwrap();
        assert_eq!(
            status.audit_authentication_status.as_deref(),
            Some(AUDIT_NO_CHECKPOINTS)
        );
    }
}
