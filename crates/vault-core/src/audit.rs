// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

//! ISO 27001 compliance audit log — metadata-only, append-only, hash-chained.
//!
//! This module never accepts secret values. Only [`AuditAction`] variants and optional
//! entry identifiers (`entry_id`) are recorded.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::audit_secure;
use crate::error::VaultError;

pub use audit_secure::secure_audit_log_file;

/// Metadata-only security events — no variant carries secret payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditAction {
    VaultCreated,
    VaultOpened,
    VaultUnlocked,
    VaultLocked,
    EntryCreated,
    EntryUpdated,
    SecretCopied,
    SecretRevealed,
    VaultKeyRotated,
}

impl AuditAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::VaultCreated => "VaultCreated",
            Self::VaultOpened => "VaultOpened",
            Self::VaultUnlocked => "VaultUnlocked",
            Self::VaultLocked => "VaultLocked",
            Self::EntryCreated => "EntryCreated",
            Self::EntryUpdated => "EntryUpdated",
            Self::SecretCopied => "SecretCopied",
            Self::SecretRevealed => "SecretRevealed",
            Self::VaultKeyRotated => "VaultKeyRotated",
        }
    }
}

/// Trait for append-only compliance logging from [`crate::vault::Vault`].
pub trait AuditLog {
    fn log(&self, action: AuditAction, entry_id: Option<&str>) -> Result<(), VaultError>;
}

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

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

    fn format_entry_id(entry_id: Option<&str>) -> String {
        match entry_id {
            Some(id) if !id.trim().is_empty() => id.trim().to_string(),
            _ => "-".to_string(),
        }
    }

    fn build_record(
        timestamp: &str,
        action: AuditAction,
        entry_id: &str,
        prev_hash: &str,
    ) -> String {
        format!(
            "[{timestamp}] [{action}] [{entry_id}] prev_hash={prev_hash}",
            timestamp = timestamp,
            action = action.as_str(),
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

    /// Records a metadata-only audit event (no secrets).
    pub fn log(&self, action: AuditAction, entry_id: Option<&str>) -> Result<(), VaultError> {
        if self.path.is_none() {
            return Ok(());
        }

        let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let entry_token = Self::format_entry_id(entry_id);

        let mut last_hash = self
            .last_hash
            .lock()
            .map_err(|_| VaultError::Other("audit logger lock poisoned".into()))?;

        let record = Self::build_record(&timestamp, action, &entry_token, &last_hash);
        let entry_hash = Self::compute_hash(&record);
        let line = format!("{record} entry_hash={entry_hash}");

        self.append_line(&line)?;
        *last_hash = entry_hash;
        Ok(())
    }
}

impl AuditLog for AuditLogger {
    fn log(&self, action: AuditAction, entry_id: Option<&str>) -> Result<(), VaultError> {
        AuditLogger::log(self, action, entry_id)
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::disabled()
    }
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
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let entry_hash = parse_entry_hash(line)?;
    let record = line.rsplit_once(" entry_hash=")?.0;

    let timestamp = parse_bracket_field(record, 0)?;
    let action = parse_bracket_field(record, 1)?;
    let entry_id = parse_bracket_field(record, 2)?;

    Some(AuditLogEntry {
        timestamp_utc: timestamp.to_string(),
        action: action.to_string(),
        entry_id: entry_id.to_string(),
        entry_hash,
    })
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
    line.rsplit_once(" entry_hash=")
        .map(|(_, hash)| hash.trim().to_string())
        .filter(|hash| hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
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
            .log(AuditAction::VaultUnlocked, None)
            .expect("log unlock");
        logger
            .log(AuditAction::EntryCreated, Some("entry-uuid-1"))
            .expect("log create");

        let log_path = audit_log_path(&vault_path);
        let raw = std::fs::read_to_string(log_path).unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("[VaultUnlocked]"));
        assert!(lines[0].contains("[-]"));
        assert!(lines[0].contains(&format!("prev_hash={GENESIS_HASH}")));
        assert!(lines[1].contains("[EntryCreated]"));
        assert!(lines[1].contains("[entry-uuid-1]"));
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
                .log(AuditAction::EntryCreated, Some(&format!("entry-{i}")))
                .expect("log");
        }

        let all = read_audit_logs(&vault_path, 10).expect("read");
        assert_eq!(all.len(), 5);
        assert_eq!(all[0].entry_id, "entry-4");
        assert_eq!(all[4].entry_id, "entry-0");

        let limited = read_audit_logs(&vault_path, 2).expect("read limited");
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].entry_id, "entry-4");
        assert_eq!(limited[1].entry_id, "entry-3");
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
        logger
            .log(AuditAction::VaultLocked, None)
            .expect("noop log");
    }

    #[test]
    fn tampered_chain_fails_verification() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("vault.oxid");
        std::fs::write(&vault_path, b"x").unwrap();
        let log_path = audit_log_path(&vault_path);

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger.log(AuditAction::VaultOpened, None).unwrap();

        let mut content = std::fs::read_to_string(&log_path).unwrap();
        content = content.replace("[VaultOpened]", "[VaultUnlocked]");
        std::fs::write(&log_path, content).unwrap();

        let err = verify_audit_chain(&log_path).expect_err("tampered chain");
        assert!(matches!(err, VaultError::AuditLogCorrupted));
    }
}
