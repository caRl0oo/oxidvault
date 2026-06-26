// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Validates and opens http(s) URLs in the system default browser.

const ALLOWED_SCHEMES: [&str; 2] = ["http", "https"];

fn has_http_scheme(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// True when the string already declares a URI scheme (e.g. `javascript:`, `file:`).
fn has_explicit_scheme(url: &str) -> bool {
    let mut chars = url.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !c.is_ascii_alphanumeric() && c != '+' && c != '-' && c != '.' {
            return false;
        }
    }
    false
}

/// Trims input and prepends `https://` when no http(s) scheme is present.
pub fn normalize_http_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL ist leer.".into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("URL enthält ungültige Zeichen.".into());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("URL darf keine Leerzeichen enthalten.".into());
    }

    let normalized = if has_http_scheme(trimmed) || has_explicit_scheme(trimmed) {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    Ok(normalized)
}

/// Normalizes (auto `https://`), then validates as a safe http(s) URL.
pub fn validate_http_url(url: &str) -> Result<String, String> {
    let normalized = normalize_http_url(url)?;

    let parsed = url::Url::parse(&normalized).map_err(|_| "URL ist ungültig.".to_string())?;
    if !ALLOWED_SCHEMES.contains(&parsed.scheme()) {
        return Err("URL muss mit http:// oder https:// beginnen.".into());
    }
    if parsed.host().is_none() {
        return Err("URL ist ungültig.".into());
    }

    Ok(normalized)
}

#[tauri::command]
pub fn open_website_url(url: String) -> Result<(), String> {
    let safe_url = validate_http_url(&url)?;
    open::that(&safe_url).map_err(|e| format!("Browser konnte nicht geöffnet werden: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_url() {
        let url = validate_http_url("  https://example.com/path ").unwrap();
        assert_eq!(url, "https://example.com/path");
    }

    #[test]
    fn accepts_http_url() {
        assert!(validate_http_url("http://localhost:8080").is_ok());
    }

    #[test]
    fn prepends_https_for_bare_domain() {
        assert_eq!(validate_http_url("google.de").unwrap(), "https://google.de");
        assert_eq!(
            validate_http_url("example.com/path?q=1").unwrap(),
            "https://example.com/path?q=1"
        );
    }

    #[test]
    fn rejects_javascript_scheme() {
        assert!(validate_http_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(validate_http_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_windows_path_without_auto_prefix() {
        assert!(validate_http_url(r"C:\Windows\System32").is_err());
    }

    #[test]
    fn rejects_empty_url() {
        assert!(validate_http_url("   ").is_err());
    }

    #[test]
    fn rejects_control_characters() {
        assert!(validate_http_url("https://ev\ril.com").is_err());
        assert!(validate_http_url("google.de/\0path").is_err());
    }
}
