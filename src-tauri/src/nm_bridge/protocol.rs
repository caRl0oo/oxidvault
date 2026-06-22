// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeRequest {
    pub action: String,
    #[serde(default)]
    pub url: Option<String>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BridgeResponse {
    pub fn not_found() -> Self {
        Self {
            status: "not_found".into(),
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn locked() -> Self {
        Self {
            status: "locked".into(),
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn unavailable() -> Self {
        Self {
            status: "unavailable".into(),
            username: None,
            password: None,
            error: Some("OxidVault desktop app is not running".into()),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            status: "error".into(),
            username: None,
            password: None,
            error: Some(message.into()),
        }
    }

    pub fn ok_login(username: String, password: String) -> Self {
        Self {
            status: "ok".into(),
            username: Some(username),
            password: Some(password),
            error: None,
        }
    }
}
