// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! Hostname / URL matching for web-login autofill (least-privilege lookup).

use crate::entry::SecretPayload;
use crate::probe::resolve_probe_target;

/// Normalizes a hostname for comparison (`WWW.` stripped, lowercase).
pub fn normalize_hostname(host: &str) -> String {
    let trimmed = host.trim().to_ascii_lowercase();
    if let Some(stripped) = trimmed.strip_prefix("www.") {
        stripped.to_string()
    } else {
        trimmed
    }
}

/// Match strength between a stored entry URL and the current page hostname.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum UrlMatchScore {
    None = 0,
    Substring = 1,
    Subdomain = 2,
    ExactHost = 3,
}

/// Scores how well `entry_url` matches `page_hostname` (from `window.location.hostname`).
pub fn score_web_login_url_match(entry_url: &str, page_hostname: &str) -> UrlMatchScore {
    let page = normalize_hostname(page_hostname);
    if page.is_empty() {
        return UrlMatchScore::None;
    }

    let entry_lower = entry_url.trim().to_ascii_lowercase();
    if entry_lower.contains(&page) {
        if let Some(entry_host) = resolve_probe_target(&SecretPayload::WebLogin {
            url: entry_url.to_string(),
            username: String::new(),
            password: String::new(),
            notes: None,
        })
        .map(|t| normalize_hostname(&t.host))
        {
            if entry_host == page {
                return UrlMatchScore::ExactHost;
            }
            if page.ends_with(&format!(".{entry_host}"))
                || entry_host.ends_with(&format!(".{page}"))
            {
                return UrlMatchScore::Subdomain;
            }
        }
        return UrlMatchScore::Substring;
    }

    let Some(entry_host) = resolve_probe_target(&SecretPayload::WebLogin {
        url: entry_url.to_string(),
        username: String::new(),
        password: String::new(),
        notes: None,
    })
    .map(|t| normalize_hostname(&t.host)) else {
        return UrlMatchScore::None;
    };

    if entry_host == page {
        return UrlMatchScore::ExactHost;
    }

    if page.ends_with(&format!(".{entry_host}")) || entry_host.ends_with(&format!(".{page}")) {
        return UrlMatchScore::Subdomain;
    }

    UrlMatchScore::None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_host_match() {
        assert_eq!(
            score_web_login_url_match("https://github.com/login", "github.com"),
            UrlMatchScore::ExactHost
        );
    }

    #[test]
    fn subdomain_match() {
        assert_eq!(
            score_web_login_url_match("https://github.com", "login.github.com"),
            UrlMatchScore::Subdomain
        );
    }

    #[test]
    fn substring_match() {
        assert_eq!(
            score_web_login_url_match("https://intranet.example/github.com/sso", "github.com"),
            UrlMatchScore::Substring
        );
    }

    #[test]
    fn no_match() {
        assert_eq!(
            score_web_login_url_match("https://example.com", "other.org"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn www_normalized() {
        assert_eq!(
            score_web_login_url_match("https://www.example.com", "example.com"),
            UrlMatchScore::ExactHost
        );
    }
}
