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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mfa_required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
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
            success: None,
            mfa_required: None,
            locked: None,
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn locked(mfa_required: bool) -> Self {
        Self {
            status: "locked".into(),
            success: None,
            mfa_required: Some(mfa_required),
            locked: Some(true),
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn unavailable() -> Self {
        Self {
            status: "unavailable".into(),
            success: None,
            mfa_required: None,
            locked: None,
            username: None,
            password: None,
            error: Some("OxidVault desktop app is not running".into()),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            status: "error".into(),
            success: None,
            mfa_required: None,
            locked: None,
            username: None,
            password: None,
            error: Some(message.into()),
        }
    }

    pub fn ok_login(username: String, password: String) -> Self {
        Self {
            status: "ok".into(),
            success: Some(true),
            mfa_required: None,
            locked: Some(false),
            username: Some(username),
            password: Some(password),
            error: None,
        }
    }

    pub fn unlock_success() -> Self {
        Self {
            status: "ok".into(),
            success: Some(true),
            mfa_required: None,
            locked: Some(false),
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn mfa_failed() -> Self {
        Self {
            status: "mfa_failed".into(),
            success: Some(false),
            mfa_required: Some(true),
            locked: Some(true),
            username: None,
            password: None,
            error: Some("Ungültiger MFA-Code in der Desktop-App".into()),
        }
    }

    pub fn vault_status(locked: bool, mfa_required: bool, mfa_failed: bool) -> Self {
        if mfa_failed {
            return Self::mfa_failed();
        }

        if locked {
            return Self::locked(mfa_required);
        }

        Self {
            status: "ok".into(),
            success: Some(true),
            mfa_required: Some(false),
            locked: Some(false),
            username: None,
            password: None,
            error: None,
        }
    }

    pub fn focus_sent() -> Self {
        Self {
            status: "ok".into(),
            success: Some(true),
            mfa_required: None,
            locked: None,
            username: None,
            password: None,
            error: None,
        }
    }
}
