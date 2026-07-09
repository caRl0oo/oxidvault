// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! File-system and native-dialog access, kept entirely in the backend so the
//! webview never gets `fs`/`dialog` capabilities. The frontend only ever
//! sees the resulting path/content, never chooses it by raw JS API access.

use std::fs;
use std::path::PathBuf;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const VAULT_FILE_NAME: &str = "vault.oxid";

fn app_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("could not resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create app data directory: {e}"))?;
    Ok(dir.join(VAULT_FILE_NAME))
}

/// Persists the (already encrypted) vault payload in the official app-local
/// data directory, resolved via Tauri's path resolver rather than any
/// frontend-supplied path.
#[tauri::command]
pub fn save_vault(app: tauri::AppHandle, data: String) -> Result<String, String> {
    let path = app_vault_path(&app)?;
    fs::write(&path, data).map_err(|e| format!("failed to write vault file: {e}"))?;
    Ok(path.display().to_string())
}

/// Reads the vault payload back from the app-local data directory.
#[tauri::command]
pub fn load_vault(app: tauri::AppHandle) -> Result<String, String> {
    let path = app_vault_path(&app)?;
    fs::read_to_string(&path).map_err(|e| format!("failed to read vault file: {e}"))
}

fn normalize_extension(path: &str, extension: &str) -> String {
    if path.to_lowercase().ends_with(&format!(".{extension}")) {
        path.to_string()
    } else {
        format!("{path}.{extension}")
    }
}

/// Opens a native "select vault file" dialog for manual import/export.
/// `mode` is either `"open"` (pick an existing `.oxid` file) or `"save"`
/// (choose a destination). The frontend never constructs the path itself.
#[tauri::command]
pub fn select_vault_file_via_dialog(
    app: tauri::AppHandle,
    mode: String,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    match mode.as_str() {
        "open" => {
            let picked = app
                .dialog()
                .file()
                .add_filter("OxidVault", &["oxid"])
                .blocking_pick_file();
            Ok(picked.map(|p| p.to_string()))
        }
        "save" => {
            let file_name = default_name.unwrap_or_else(|| VAULT_FILE_NAME.to_string());
            let picked = app
                .dialog()
                .file()
                .set_file_name(&file_name)
                .add_filter("OxidVault", &["oxid"])
                .blocking_save_file();
            Ok(picked.map(|p| normalize_extension(&p.to_string(), "oxid")))
        }
        other => Err(format!("unknown dialog mode: {other}")),
    }
}

#[derive(serde::Serialize)]
pub struct AuditExportSelection {
    pub path: String,
    pub format: String,
}

/// Dialog for choosing where to export the audit log (json or csv).
#[tauri::command]
pub fn pick_audit_export_path(
    app: tauri::AppHandle,
) -> Result<Option<AuditExportSelection>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name("audit-report.json")
        .add_filter("JSON", &["json"])
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    let Some(picked) = picked else {
        return Ok(None);
    };

    let raw = picked.to_string();
    let format = if raw.to_lowercase().ends_with(".csv") {
        "csv"
    } else {
        "json"
    };
    Ok(Some(AuditExportSelection {
        path: normalize_extension(&raw, format),
        format: format.to_string(),
    }))
}

/// Dialog for choosing where to export the compliance report PDF.
#[tauri::command]
pub fn pick_audit_pdf_export_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_name = format!(
        "OxidVault-Compliance-Report-{}.pdf",
        chrono_today_date_stamp()
    );
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();
    Ok(picked.map(|p| normalize_extension(&p.to_string(), "pdf")))
}

fn chrono_today_date_stamp() -> String {
    // Avoid pulling in chrono just for a filename suffix; std has enough for a UTC date stamp.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
    // Days since epoch -> proleptic Gregorian date (civil_from_days algorithm).
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Dialog for picking a file to import (Bitwarden JSON or generic CSV).
#[tauri::command]
pub fn pick_import_path(app: tauri::AppHandle, format: String) -> Result<Option<String>, String> {
    let extension = if format == "bitwarden" { "json" } else { "csv" };
    let picked = app
        .dialog()
        .file()
        .add_filter(extension.to_uppercase(), &[extension])
        .blocking_pick_file();
    Ok(picked.map(|p| p.to_string()))
}

/// Reads a UTF-8 text file the user selected via [`pick_import_path`].
#[tauri::command]
pub fn read_text_file_cmd(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("failed to read file: {e}"))
}

/// Writes binary data (e.g. a generated PDF) to a path the user selected
/// via [`pick_audit_pdf_export_path`].
#[tauri::command]
pub fn write_binary_file_cmd(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| format!("failed to write file: {e}"))
}
