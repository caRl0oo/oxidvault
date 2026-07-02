// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Dual-format audit report export with mandatory hash-chain verification.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::audit::{audit_log_path, parse_audit_line, verify_audit_chain};
use crate::error::VaultError;

const REPORT_VERSION: &str = "1.0";

/// Supported audit report export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Json,
    Csv,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Result<Self, VaultError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "json" => Ok(Self::Json),
            "csv" => Ok(Self::Csv),
            _ => Err(VaultError::Other(format!(
                "unsupported export format: {value}"
            ))),
        }
    }
}

/// Full audit row including hash-chain fields (metadata-only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntryExport {
    pub timestamp_utc: String,
    pub action: String,
    pub entry_id: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

/// Cryptographic integrity header for JSON audit reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditExportIntegrity {
    pub report_version: String,
    pub exported_at_utc: String,
    pub source_vault_path: String,
    pub source_log_path: String,
    pub entry_count: usize,
    pub chain_verified: bool,
    pub chain_tail_hash: String,
    pub report_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJsonReport {
    pub integrity: AuditExportIntegrity,
    pub entries: Vec<AuditLogEntryExport>,
}

/// Validates the hash chain, exports all audit entries, and writes the report to `target_path`.
///
/// `vault_path` points at the `.oxid` vault file; the source log is `{vault}.audit.log`.
pub fn export_audit_report(
    vault_path: PathBuf,
    target_path: PathBuf,
    format: ExportFormat,
) -> Result<PathBuf, VaultError> {
    let log_path = audit_log_path(&vault_path);
    verify_audit_chain(&log_path)?;

    let entries = read_all_audit_entries(&log_path)?;
    let chain_tail_hash = entries
        .last()
        .map(|entry| entry.entry_hash.clone())
        .unwrap_or_else(genesis_hash);

    match format {
        ExportFormat::Json => write_json_report(
            &target_path,
            &vault_path,
            &log_path,
            &entries,
            &chain_tail_hash,
        )?,
        ExportFormat::Csv => write_csv_report(&target_path, &entries)?,
    }

    Ok(target_path)
}

fn genesis_hash() -> String {
    "0000000000000000000000000000000000000000000000000000000000000000".to_string()
}

fn read_all_audit_entries(log_path: &Path) -> Result<Vec<AuditLogEntryExport>, VaultError> {
    if !log_path.is_file() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(log_path)?;
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_audit_export_line)
        .collect()
}

fn parse_audit_export_line(line: &str) -> Result<AuditLogEntryExport, VaultError> {
    let parsed = parse_audit_line(line)?;
    Ok(AuditLogEntryExport {
        timestamp_utc: parsed.timestamp_utc,
        action: parsed.action,
        entry_id: parsed.entry_id,
        prev_hash: parsed.prev_hash,
        entry_hash: parsed.entry_hash,
    })
}

fn compute_report_hash(
    exported_at: &str,
    chain_tail_hash: &str,
    entries: &[AuditLogEntryExport],
) -> Result<String, VaultError> {
    let entries_json = serde_json::to_string(entries)
        .map_err(|e| VaultError::Other(format!("audit export serialization failed: {e}")))?;
    let payload = format!("{REPORT_VERSION}|{exported_at}|{chain_tail_hash}|{entries_json}");
    Ok(hex_encode(&Sha256::digest(payload.as_bytes())))
}

fn write_json_report(
    target_path: &Path,
    vault_path: &Path,
    log_path: &Path,
    entries: &[AuditLogEntryExport],
    chain_tail_hash: &str,
) -> Result<(), VaultError> {
    let exported_at = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let report_hash = compute_report_hash(&exported_at, chain_tail_hash, entries)?;

    let report = AuditJsonReport {
        integrity: AuditExportIntegrity {
            report_version: REPORT_VERSION.to_string(),
            exported_at_utc: exported_at,
            source_vault_path: vault_path.to_string_lossy().into_owned(),
            source_log_path: log_path.to_string_lossy().into_owned(),
            entry_count: entries.len(),
            chain_verified: true,
            chain_tail_hash: chain_tail_hash.to_string(),
            report_hash,
        },
        entries: entries.to_vec(),
    };

    let json = serde_json::to_string_pretty(&report)
        .map_err(|e| VaultError::Other(format!("audit export serialization failed: {e}")))?;

    let mut file = File::create(target_path)?;
    file.write_all(json.as_bytes())?;
    file.flush()?;
    Ok(())
}

fn write_csv_report(target_path: &Path, entries: &[AuditLogEntryExport]) -> Result<(), VaultError> {
    let mut file = File::create(target_path)?;
    writeln!(file, "timestamp_utc,action,entry_id,prev_hash,entry_hash")?;

    for entry in entries {
        writeln!(
            file,
            "{},{},{},{},{}",
            csv_escape(&entry.timestamp_utc),
            csv_escape(&entry.action),
            csv_escape(&entry.entry_id),
            csv_escape(&entry.prev_hash),
            csv_escape(&entry.entry_hash),
        )?;
    }

    file.flush()?;
    Ok(())
}

fn csv_escape(value: &str) -> String {
    if value.contains(['"', ',', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::{AuditAction, AuditLogger};
    use tempfile::tempdir;

    #[test]
    fn export_json_contains_integrity_header() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger
            .log(AuditAction::VaultUnlocked {
                lock_id: "lock-1".into(),
            })
            .expect("log");

        let target = dir.path().join("report.json");
        export_audit_report(vault_path.clone(), target.clone(), ExportFormat::Json)
            .expect("export json");

        let raw = std::fs::read_to_string(target).unwrap();
        let report: AuditJsonReport = serde_json::from_str(&raw).unwrap();
        assert_eq!(report.integrity.report_version, REPORT_VERSION);
        assert!(report.integrity.chain_verified);
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.integrity.report_hash.len(), 64);
    }

    #[test]
    fn export_csv_writes_header_and_rows() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger
            .log(AuditAction::SecretCreated {
                id: uuid::Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            })
            .expect("log");

        let target = dir.path().join("report.csv");
        export_audit_report(vault_path, target.clone(), ExportFormat::Csv).expect("export csv");

        let raw = std::fs::read_to_string(target).unwrap();
        assert!(raw.starts_with("timestamp_utc,action,entry_id,prev_hash,entry_hash"));
        assert!(raw.contains("SecretCreated"));
        assert!(raw.contains("550e8400-e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn export_aborts_on_corrupted_chain() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("vault.oxid");
        std::fs::write(&vault_path, b"x").unwrap();
        let log_path = audit_log_path(&vault_path);

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger.log(AuditAction::VaultOpened).unwrap();

        let mut content = std::fs::read_to_string(&log_path).unwrap();
        content = content.replace("[VaultOpened]", "[VaultUnlocked]");
        std::fs::write(&log_path, content).unwrap();

        let target = dir.path().join("report.json");
        let err = export_audit_report(vault_path, target, ExportFormat::Json)
            .expect_err("corrupted chain");
        assert!(matches!(err, VaultError::AuditLogCorrupted));
    }
}
