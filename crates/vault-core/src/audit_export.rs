// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Dual-format audit report export with mandatory hash-chain verification.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use printpdf::{BuiltinFont, Line, Mm, PdfDocument, Point};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::audit::{audit_log_path, read_audit_logs, verify_audit_chain};
use crate::compliance::ComplianceStatus;
use crate::error::VaultError;

const REPORT_VERSION: &str = "1.0";
const PDF_AUDIT_DISPLAY_LIMIT: usize = 50;

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

/// Generates a branded A4 PDF compliance summary with status and the newest audit events.
pub fn export_audit_report_pdf(
    vault_path: &Path,
    target_path: &Path,
    compliance: &ComplianceStatus,
) -> Result<(), VaultError> {
    let log_path = audit_log_path(vault_path);
    let total_entries = read_all_audit_entries(&log_path)?.len();
    let logs = read_audit_logs(vault_path, PDF_AUDIT_DISPLAY_LIMIT).unwrap_or_default();

    let (doc, page1, layer1) = PdfDocument::new(
        "OxidVault DSGVO Compliance Report",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let current_layer = doc.get_page(page1).get_layer(layer1);

    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(pdf_error)?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(pdf_error)?;

    current_layer.use_text("OxidVault", 24.0, Mm(20.0), Mm(270.0), &font_bold);
    current_layer.use_text(
        "DSGVO Compliance Report",
        14.0,
        Mm(20.0),
        Mm(260.0),
        &font_regular,
    );

    let now = Utc::now().format("%d.%m.%Y %H:%M UTC").to_string();
    current_layer.use_text(
        format!("Erstellt: {now}"),
        10.0,
        Mm(20.0),
        Mm(252.0),
        &font_regular,
    );
    current_layer.use_text(
        format!(
            "Vault: {}",
            truncate_for_pdf(&vault_path.display().to_string(), 70)
        ),
        10.0,
        Mm(20.0),
        Mm(246.0),
        &font_regular,
    );

    let separator = Line::from_iter(vec![
        (Point::new(Mm(20.0), Mm(242.0)), false),
        (Point::new(Mm(190.0), Mm(242.0)), false),
    ]);
    current_layer.set_outline_thickness(0.5);
    current_layer.add_line(separator);

    current_layer.use_text("Compliance-Status", 12.0, Mm(20.0), Mm(234.0), &font_bold);

    let status_text = if compliance.audit_chain_valid && !compliance.key_rotation_recommended {
        "Compliance OK"
    } else {
        "Handlungsbedarf"
    };
    current_layer.use_text(status_text, 11.0, Mm(20.0), Mm(226.0), &font_regular);

    let chain_label = if compliance.audit_chain_valid {
        "Ja"
    } else {
        "Nein"
    };
    current_layer.use_text(
        format!("Hash-Kette valide: {chain_label}"),
        10.0,
        Mm(20.0),
        Mm(219.0),
        &font_regular,
    );
    current_layer.use_text(
        format!("Schluessel-Alter: {} Tage", compliance.key_age_days),
        10.0,
        Mm(20.0),
        Mm(213.0),
        &font_regular,
    );
    let gpo_label = if compliance.policy_managed_by_gpo {
        "Ja"
    } else {
        "Nein"
    };
    current_layer.use_text(
        format!("GPO verwaltet: {gpo_label}"),
        10.0,
        Mm(20.0),
        Mm(207.0),
        &font_regular,
    );
    if compliance.key_rotation_recommended {
        current_layer.use_text(
            "Schluessel-Rotation empfohlen (> 90 Tage)",
            10.0,
            Mm(20.0),
            Mm(201.0),
            &font_regular,
        );
    }

    current_layer.use_text(
        format!("Audit-Ereignisse (letzte {PDF_AUDIT_DISPLAY_LIMIT})"),
        12.0,
        Mm(20.0),
        Mm(192.0),
        &font_bold,
    );

    current_layer.use_text("Zeit (UTC)", 9.0, Mm(20.0), Mm(184.0), &font_bold);
    current_layer.use_text("Aktion", 9.0, Mm(70.0), Mm(184.0), &font_bold);
    current_layer.use_text("Eintrag-ID", 9.0, Mm(130.0), Mm(184.0), &font_bold);

    let min_y = if total_entries > PDF_AUDIT_DISPLAY_LIMIT {
        45.0
    } else {
        20.0
    };

    let mut y = 177.0f32;
    for log in &logs {
        if y < min_y {
            break;
        }

        let time = log.timestamp_utc.chars().take(16).collect::<String>();
        current_layer.use_text(time, 8.0, Mm(20.0), Mm(y), &font_regular);
        current_layer.use_text(
            truncate_for_pdf(&log.action, 28),
            8.0,
            Mm(70.0),
            Mm(y),
            &font_regular,
        );
        current_layer.use_text(
            display_entry_id(&log.entry_id),
            8.0,
            Mm(130.0),
            Mm(y),
            &font_regular,
        );

        y -= 6.0;
    }

    if total_entries > PDF_AUDIT_DISPLAY_LIMIT {
        current_layer.use_text(
            format!(
                "Hinweis: Zeigt die letzten {PDF_AUDIT_DISPLAY_LIMIT} von {total_entries} Ereignissen."
            ),
            8.0,
            Mm(20.0),
            Mm(35.0),
            &font_regular,
        );
        current_layer.use_text(
            "Vollstaendiger Export als JSON/CSV verfuegbar.",
            8.0,
            Mm(20.0),
            Mm(29.0),
            &font_regular,
        );
    }

    let footer_line = Line::from_iter(vec![
        (Point::new(Mm(20.0), Mm(13.0)), false),
        (Point::new(Mm(190.0), Mm(13.0)), false),
    ]);
    current_layer.set_outline_thickness(0.5);
    current_layer.add_line(footer_line);

    current_layer.use_text(
        format!("OxidVault v{} - oxidvault.com", env!("CARGO_PKG_VERSION")),
        8.0,
        Mm(20.0),
        Mm(8.0),
        &font_regular,
    );

    let file = File::create(target_path)?;
    let mut writer = BufWriter::new(file);
    doc.save(&mut writer).map_err(pdf_error)?;
    writer.flush()?;

    Ok(())
}

fn pdf_error(error: printpdf::Error) -> VaultError {
    VaultError::Other(format!("pdf export failed: {error}"))
}

fn truncate_for_pdf(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{truncated}...")
}

fn display_entry_id(entry_id: &str) -> String {
    if entry_id.is_empty() {
        return "-".to_string();
    }
    truncate_for_pdf(entry_id, 20)
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
    let line = line.trim();
    let entry_hash = parse_entry_hash(line).ok_or(VaultError::AuditLogCorrupted)?;
    let record = line
        .rsplit_once(" entry_hash=")
        .map(|(prefix, _)| prefix)
        .ok_or(VaultError::AuditLogCorrupted)?;

    let timestamp = parse_bracket_field(record, 0).ok_or(VaultError::AuditLogCorrupted)?;
    let action = parse_bracket_field(record, 1).ok_or(VaultError::AuditLogCorrupted)?;
    let entry_id = parse_bracket_field(record, 2).ok_or(VaultError::AuditLogCorrupted)?;
    let prev_hash = parse_prev_hash(record).ok_or(VaultError::AuditLogCorrupted)?;

    Ok(AuditLogEntryExport {
        timestamp_utc: timestamp.to_string(),
        action: action.to_string(),
        entry_id: entry_id.to_string(),
        prev_hash,
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

fn parse_prev_hash(record: &str) -> Option<String> {
    record
        .rsplit_once("prev_hash=")
        .map(|(_, hash)| hash.trim().to_string())
        .filter(|hash| hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
}

fn parse_entry_hash(line: &str) -> Option<String> {
    line.rsplit_once(" entry_hash=")
        .map(|(_, hash)| hash.trim().to_string())
        .filter(|hash| hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
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
    use crate::compliance::ComplianceStatus;
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
    fn export_pdf_writes_valid_file() {
        let dir = tempdir().unwrap();
        let vault_path = dir.path().join("team.oxid");
        std::fs::write(&vault_path, b"dummy").unwrap();

        let logger = AuditLogger::for_vault(&vault_path).unwrap();
        logger
            .log(AuditAction::VaultUnlocked {
                lock_id: "lock-1".into(),
            })
            .expect("log");

        let compliance = ComplianceStatus {
            policy_managed_by_gpo: false,
            audit_chain_valid: true,
            key_created_at: None,
            key_rotated_at: None,
            key_age_days: 0,
            key_rotation_recommended: false,
        };
        let target = dir.path().join("report.pdf");
        export_audit_report_pdf(&vault_path, &target, &compliance).expect("export pdf");

        let bytes = std::fs::read(&target).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
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
