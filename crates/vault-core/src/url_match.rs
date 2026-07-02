// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Hostname / URL matching for web-login autofill (least-privilege lookup).

use std::net::IpAddr;

use url::Url;

use crate::entry::SecretPayload;
use crate::probe::resolve_probe_target;

/// Match strength between a stored entry URL and the current page hostname.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum UrlMatchScore {
    None = 0,
    Subdomain = 1,
    ExactHost = 2,
}

/// Normalizes a hostname for comparison (lowercase, `www.` stripped, punycode via [`Url`]).
pub fn normalize_hostname(host: &str) -> String {
    normalized_host_from_input(host.trim()).unwrap_or_default()
}

/// Scores how well `entry_url` matches `page_hostname` (from `window.location.hostname`).
pub fn score_web_login_url_match(entry_url: &str, page_hostname: &str) -> UrlMatchScore {
    let page_host = normalize_hostname(page_hostname);
    if page_host.is_empty() {
        return UrlMatchScore::None;
    }

    let Some(entry_host) = host_from_entry_url(entry_url) else {
        return UrlMatchScore::None;
    };

    if page_host == entry_host {
        return UrlMatchScore::ExactHost;
    }

    if lacks_registrable_domain(&page_host) || lacks_registrable_domain(&entry_host) {
        return UrlMatchScore::None;
    }

    let Some(entry_rd) = registrable_domain(&entry_host) else {
        return UrlMatchScore::None;
    };

    if page_is_subdomain_of_registrable(&page_host, &entry_rd) {
        return UrlMatchScore::Subdomain;
    }

    UrlMatchScore::None
}

fn normalized_host_from_input(input: &str) -> Option<String> {
    if input.is_empty() {
        return None;
    }

    if let Ok(url) = Url::parse(input) {
        if let Some(host) = url.host_str() {
            return Some(strip_www(&host.to_ascii_lowercase()));
        }
    }

    let candidate = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&candidate).ok()?;
    let host = url.host_str()?;
    Some(strip_www(&host.to_ascii_lowercase()))
}

fn strip_www(host: &str) -> String {
    host.strip_prefix("www.")
        .map(str::to_string)
        .unwrap_or_else(|| host.to_string())
}

fn host_from_entry_url(entry_url: &str) -> Option<String> {
    resolve_probe_target(&SecretPayload::WebLogin {
        url: entry_url.to_string(),
        username: String::new(),
        password: String::new(),
        notes: None,
    })
    .and_then(|target| normalized_host_from_input(&target.host))
}

fn lacks_registrable_domain(host: &str) -> bool {
    if host.parse::<IpAddr>().is_ok() {
        return true;
    }
    if host == "localhost" {
        return true;
    }
    if !host.contains('.') {
        return true;
    }
    registrable_domain(host).is_none()
}

fn registrable_domain(host: &str) -> Option<String> {
    psl::domain_str(host).map(|domain| domain.to_ascii_lowercase())
}

fn page_is_subdomain_of_registrable(page_host: &str, entry_registrable: &str) -> bool {
    let Some(page_rd) = registrable_domain(page_host) else {
        return false;
    };
    if page_rd != entry_registrable {
        return false;
    }
    page_host.ends_with(&format!(".{entry_registrable}"))
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
    fn subdomain_match_login_github() {
        assert_eq!(
            score_web_login_url_match("https://github.com", "login.github.com"),
            UrlMatchScore::Subdomain
        );
    }

    #[test]
    fn evilgithub_does_not_match_github() {
        assert_eq!(
            score_web_login_url_match("https://github.com", "evilgithub.com"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn github_com_evil_example_does_not_match() {
        assert_eq!(
            score_web_login_url_match("https://github.com", "github.com.evil.example"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn multi_part_etld_subdomain_matches() {
        assert_eq!(
            score_web_login_url_match("https://example.co.uk", "sub.example.co.uk"),
            UrlMatchScore::Subdomain
        );
    }

    #[test]
    fn multi_part_etld_similar_name_does_not_match() {
        assert_eq!(
            score_web_login_url_match("https://example.co.uk", "evil-example.co.uk"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn ip_exact_only() {
        assert_eq!(
            score_web_login_url_match("https://192.168.1.10", "192.168.1.10"),
            UrlMatchScore::ExactHost
        );
        assert_eq!(
            score_web_login_url_match("https://192.168.1.10", "192.168.1.11"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn single_label_intranet_exact_only() {
        assert_eq!(
            score_web_login_url_match("https://nas", "nas"),
            UrlMatchScore::ExactHost
        );
        assert_eq!(
            score_web_login_url_match("https://localhost", "localhost.evil.com"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn idn_entry_matches_punycode_page_host() {
        assert_eq!(
            score_web_login_url_match("https://münchen.de/login", "xn--mnchen-3ya.de"),
            UrlMatchScore::ExactHost
        );
    }

    #[test]
    fn www_normalized() {
        assert_eq!(
            score_web_login_url_match("https://www.example.com", "example.com"),
            UrlMatchScore::ExactHost
        );
    }

    #[test]
    fn no_match_unrelated_hosts() {
        assert_eq!(
            score_web_login_url_match("https://example.com", "other.org"),
            UrlMatchScore::None
        );
    }

    #[test]
    fn substring_in_path_does_not_match() {
        assert_eq!(
            score_web_login_url_match("https://intranet.example/github.com/sso", "github.com"),
            UrlMatchScore::None
        );
    }
}
