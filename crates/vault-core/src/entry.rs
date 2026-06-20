use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretKindTag {
    WebLogin,
    SshKey,
    ApiToken,
    Database,
    NetworkWifi,
    SecureNote,
}
impl SecretKindTag {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::WebLogin => "web_login",
            Self::SshKey => "ssh_key",
            Self::ApiToken => "api_token",
            Self::Database => "database",
            Self::NetworkWifi => "network_wifi",
            Self::SecureNote => "secure_note",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SecretPayload {
    WebLogin {
        url: String,
        username: String,
        password: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        notes: Option<String>,
    },
    SshKey {
        host: String,
        username: String,
        private_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
    },
    ApiToken {
        service: String,
        token: String,
    },
    Database {
        host: String,
        port: u16,
        db_type: String,
        database_name: String,
        username: String,
        password: String,
    },
    NetworkWifi {
        ssid: String,
        encryption_type: String,
        password: String,
    },
    SecureNote {
        content: String,
    },
}
impl SecretPayload {
    /// Overwrites sensitive string fields in RAM before lock/drop.
    pub fn zeroize_secrets(&mut self) {
        match self {
            Self::WebLogin { password, notes, .. } => {
                password.zeroize();
                if let Some(n) = notes {
                    n.zeroize();
                }
            }
            Self::SshKey {
                private_key,
                passphrase,
                ..
            } => {
                private_key.zeroize();
                if let Some(p) = passphrase {
                    p.zeroize();
                }
            }
            Self::ApiToken { token, .. } => {
                token.zeroize();
            }
            Self::Database { password, .. } => {
                password.zeroize();
            }
            Self::NetworkWifi { password, .. } => {
                password.zeroize();
            }
            Self::SecureNote { content } => {
                content.zeroize();
            }
        }
    }
    pub fn kind_tag(&self) -> SecretKindTag {
        match self {
            Self::WebLogin { .. } => SecretKindTag::WebLogin,
            Self::SshKey { .. } => SecretKindTag::SshKey,
            Self::ApiToken { .. } => SecretKindTag::ApiToken,
            Self::Database { .. } => SecretKindTag::Database,
            Self::NetworkWifi { .. } => SecretKindTag::NetworkWifi,
            Self::SecureNote { .. } => SecretKindTag::SecureNote,
        }
    }
    pub fn subtitle(&self) -> Option<String> {
        match self {
            Self::WebLogin { url, .. } => Some(url.clone()),
            Self::SshKey { host, .. } => Some(host.clone()),
            Self::ApiToken { service, .. } => Some(service.clone()),
            Self::Database {
                host,
                port,
                database_name,
                db_type,
                ..
            } => Some(format!("{db_type} · {host}:{port}/{database_name}")),
            Self::NetworkWifi { ssid, encryption_type, .. } => {
                Some(format!("{ssid} ({encryption_type})"))
            }
            Self::SecureNote { content } => {
                let preview: String = content.lines().next().unwrap_or("").chars().take(48).collect();
                if preview.is_empty() {
                    None
                } else if content.len() > preview.len() {
                    Some(format!("{preview}…"))
                } else {
                    Some(preview)
                }
            }
        }
    }
    pub fn username(&self) -> Option<String> {
        match self {
            Self::WebLogin { username, .. } | Self::SshKey { username, .. } => {
                Some(username.clone())
            }
            Self::Database { username, .. } => Some(username.clone()),
            Self::ApiToken { .. } | Self::NetworkWifi { .. } | Self::SecureNote { .. } => None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(flatten)]
    pub payload: SecretPayload,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntryInput {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(flatten)]
    pub payload: SecretPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntrySummary {
    pub id: String,
    pub title: String,
    pub entry_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub updated_at: String,
}
impl SecretEntry {
    pub fn zeroize_secrets(&mut self) {
        self.payload.zeroize_secrets();
    }
    pub fn from_input(input: SecretEntryInput) -> Result<Self, crate::error::VaultError> {
        validate_input(&input)?;
        let now = timestamp_now();
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            title: input.title.trim().to_string(),
            folder: normalize_folder(input.folder),
            tags: normalize_tags(input.tags),
            expires_at: crate::expiry::normalize_expires_at(input.expires_at),
            payload: input.payload,
            created_at: now.clone(),
            updated_at: now,
        })
    }
    pub fn update_from(
        id: &str,
        created_at: String,
        input: SecretEntryInput,
    ) -> Result<Self, crate::error::VaultError> {
        validate_input(&input)?;
        Ok(Self {
            id: id.to_string(),
            title: input.title.trim().to_string(),
            folder: normalize_folder(input.folder),
            tags: normalize_tags(input.tags),
            expires_at: crate::expiry::normalize_expires_at(input.expires_at),
            payload: input.payload,
            created_at,
            updated_at: timestamp_now(),
        })
    }
    pub fn summary(&self) -> SecretEntrySummary {
        SecretEntrySummary {
            id: self.id.clone(),
            title: self.title.clone(),
            entry_type: self.payload.kind_tag().as_str().to_string(),
            folder: self.folder.clone(),
            tags: self.tags.clone(),
            subtitle: self.payload.subtitle(),
            username: self.payload.username(),
            updated_at: self.updated_at.clone(),
        }
    }
}
fn normalize_folder(folder: Option<String>) -> Option<String> {
    folder.and_then(|f| {
        let trimmed = f.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.iter().any(|existing: &String| existing.eq_ignore_ascii_case(trimmed)) {
            out.push(trimmed.to_string());
        }
    }
    out
}
fn validate_input(input: &SecretEntryInput) -> Result<(), crate::error::VaultError> {
    if input.title.trim().is_empty() {
        return Err(crate::error::VaultError::Other("title is required".into()));
    }
    if let Some(ref expires_at) = input.expires_at {
        if crate::expiry::normalize_expires_at(Some(expires_at.clone())).is_none() {
            return Err(crate::error::VaultError::Other(
                "expires_at must be YYYY-MM-DD".into(),
            ));
        }
    }
    match &input.payload {
        SecretPayload::WebLogin {
            url,
            username,
            password,
            ..
        } => {
            if url.trim().is_empty() || username.trim().is_empty() || password.is_empty() {
                return Err(crate::error::VaultError::Other(
                    "web login fields are incomplete".into(),
                ));
            }
        }
        SecretPayload::SshKey {
            host,
            username,
            private_key,
            ..
        } => {
            if host.trim().is_empty() || username.trim().is_empty() || private_key.trim().is_empty()
            {
                return Err(crate::error::VaultError::Other(
                    "ssh key fields are incomplete".into(),
                ));
            }
        }
        SecretPayload::ApiToken { service, token } => {
            if service.trim().is_empty() || token.trim().is_empty() {
                return Err(crate::error::VaultError::Other(
                    "api token fields are incomplete".into(),
                ));
            }
        }
        SecretPayload::Database {
            host,
            port,
            db_type,
            database_name,
            username,
            password,
        } => {
            if host.trim().is_empty()
                || *port == 0
                || db_type.trim().is_empty()
                || database_name.trim().is_empty()
                || username.trim().is_empty()
                || password.is_empty()
            {
                return Err(crate::error::VaultError::Other(
                    "database fields are incomplete".into(),
                ));
            }
        }
        SecretPayload::NetworkWifi {
            ssid,
            encryption_type,
            password,
        } => {
            if ssid.trim().is_empty() || encryption_type.trim().is_empty() || password.is_empty() {
                return Err(crate::error::VaultError::Other(
                    "network wifi fields are incomplete".into(),
                ));
            }
        }
        SecretPayload::SecureNote { content } => {
            if content.trim().is_empty() {
                return Err(crate::error::VaultError::Other(
                    "secure note content is required".into(),
                ));
            }
        }
    }
    Ok(())
}
fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_web_login_entry() {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "GitHub".into(),
            folder: None,
            tags: vec![],
            expires_at: None,
            payload: SecretPayload::WebLogin {
                url: "https://github.com".into(),
                username: "dev".into(),
                password: "secret".into(),
                notes: None,
            },
        })
        .unwrap();
        assert_eq!(entry.summary().entry_type, "web_login");
    }
    #[test]
    fn creates_database_entry() {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "Prod DB".into(),
            folder: None,
            tags: vec![],
            expires_at: None,
            payload: SecretPayload::Database {
                host: "10.0.0.5".into(),
                port: 5432,
                db_type: "postgresql".into(),
                database_name: "app".into(),
                username: "admin".into(),
                password: "secret".into(),
            },
        })
        .unwrap();
        let summary = entry.summary();
        assert_eq!(summary.entry_type, "database");
        assert!(summary.subtitle.unwrap().contains("postgresql"));
    }
    #[test]
    fn creates_network_wifi_entry() {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "Office WLAN".into(),
            folder: None,
            tags: vec![],
            expires_at: None,
            payload: SecretPayload::NetworkWifi {
                ssid: "CorpNet".into(),
                encryption_type: "wpa2".into(),
                password: "wifi-key".into(),
            },
        })
        .unwrap();
        assert_eq!(entry.summary().entry_type, "network_wifi");
    }
    #[test]
    fn creates_secure_note_entry() {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "nginx.conf".into(),
            folder: Some("Infrastruktur".into()),
            tags: vec!["prod".into(), "Prod".into(), "  web  ".into()],
            expires_at: None,
            payload: SecretPayload::SecureNote {
                content: "server { listen 443; }".into(),
            },
        })
        .unwrap();
        assert_eq!(entry.summary().entry_type, "secure_note");
        assert_eq!(entry.folder.as_deref(), Some("Infrastruktur"));
        assert_eq!(entry.tags, vec!["prod", "web"]);
    }
    #[test]
    fn entry_without_folder_tags_deserializes_defaults() {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "Legacy".into(),
            folder: None,
            tags: vec![],
            expires_at: None,
            payload: SecretPayload::ApiToken {
                service: "svc".into(),
                token: "tok".into(),
            },
        })
        .unwrap();
        assert!(entry.folder.is_none());
        assert!(entry.tags.is_empty());
    }
}
