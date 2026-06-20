use crate::entry::SecretPayload;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeTarget {
    pub host: String,
    pub port: u16,
}

/// Resolves host/port for infrastructure reachability checks.
pub fn resolve_probe_target(payload: &SecretPayload) -> Option<ProbeTarget> {
    match payload {
        SecretPayload::WebLogin { url, .. } => web_url_probe_target(url),
        SecretPayload::SshKey { host, .. } => {
            parse_host_port(host, 22).map(|(host, port)| ProbeTarget { host, port })
        }
        SecretPayload::Database { host, port, .. } => {
            let host = host.trim();
            if host.is_empty() || *port == 0 {
                None
            } else {
                Some(ProbeTarget {
                    host: host.to_string(),
                    port: *port,
                })
            }
        }
        SecretPayload::ApiToken { .. }
        | SecretPayload::NetworkWifi { .. }
        | SecretPayload::SecureNote { .. } => None,
    }
}

fn web_url_probe_target(raw_url: &str) -> Option<ProbeTarget> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = if has_http_scheme(trimmed) || has_explicit_scheme(trimmed) {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = url::Url::parse(&candidate).ok()?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let host = parsed.host_str()?.to_string();
    let port = parsed
        .port_or_known_default()
        .unwrap_or(if scheme == "https" { 443 } else { 80 });

    Some(ProbeTarget { host, port })
}

fn has_http_scheme(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

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

/// Parses `host`, `host:port`, or `[ipv6]:port`.
pub fn parse_host_port(host: &str, default_port: u16) -> Option<(String, u16)> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }

    if host.starts_with('[') {
        if let Some(bracket_end) = host.find(']') {
            let addr = host[1..bracket_end].to_string();
            let rest = &host[bracket_end + 1..];
            if rest.starts_with(':') {
                let port: u16 = rest[1..].parse().ok()?;
                return Some((addr, port));
            }
            return Some((addr, default_port));
        }
        return None;
    }

    if let Some((h, p)) = host.rsplit_once(':') {
        if let Ok(port) = p.parse::<u16>() {
            if !h.is_empty() && !h.contains(':') {
                return Some((h.to_string(), port));
            }
        }
    }

    Some((host.to_string(), default_port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_login_https_default_port() {
        let target = resolve_probe_target(&SecretPayload::WebLogin {
            url: "https://example.com/path".into(),
            username: "u".into(),
            password: "p".into(),
            notes: None,
        })
        .unwrap();
        assert_eq!(target.host, "example.com");
        assert_eq!(target.port, 443);
    }

    #[test]
    fn web_login_bare_domain_uses_443() {
        let target = resolve_probe_target(&SecretPayload::WebLogin {
            url: "intranet.local".into(),
            username: "u".into(),
            password: "p".into(),
            notes: None,
        })
        .unwrap();
        assert_eq!(target.port, 443);
    }

    #[test]
    fn ssh_default_port_22() {
        let target = resolve_probe_target(&SecretPayload::SshKey {
            host: "10.0.0.1".into(),
            username: "root".into(),
            private_key: "key".into(),
            passphrase: None,
        })
        .unwrap();
        assert_eq!(target.port, 22);
    }

    #[test]
    fn ssh_custom_port() {
        let target = resolve_probe_target(&SecretPayload::SshKey {
            host: "bastion.example.com:2222".into(),
            username: "root".into(),
            private_key: "key".into(),
            passphrase: None,
        })
        .unwrap();
        assert_eq!(target.port, 2222);
    }

    #[test]
    fn database_uses_configured_port() {
        let target = resolve_probe_target(&SecretPayload::Database {
            host: "db.internal".into(),
            port: 5432,
            db_type: "postgresql".into(),
            database_name: "app".into(),
            username: "admin".into(),
            password: "secret".into(),
        })
        .unwrap();
        assert_eq!(target.port, 5432);
    }

    #[test]
    fn api_token_not_probeable() {
        assert!(resolve_probe_target(&SecretPayload::ApiToken {
            service: "x".into(),
            token: "t".into(),
        })
        .is_none());
    }
}
