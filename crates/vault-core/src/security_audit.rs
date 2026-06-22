// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

use std::collections::HashMap;

use serde::Serialize;

use crate::entry::{SecretEntry, SecretPayload};
use crate::expiry::{expiry_status, ExpiryStatusKind};

pub const MIN_STORED_PASSWORD_LEN: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAuditReport {
    pub score_percent: u8,
    pub total_audited: usize,
    pub weak_count: usize,
    pub duplicate_group_count: usize,
    pub duplicate_entry_count: usize,
    pub expiring_count: usize,
    pub duplicate_groups: Vec<DuplicatePasswordGroup>,
    pub weak_entries: Vec<WeakPasswordEntry>,
    pub expiring_entries: Vec<ExpiringPasswordEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePasswordGroup {
    pub entry_ids: Vec<String>,
    pub titles: Vec<String>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakPasswordEntry {
    pub entry_id: String,
    pub title: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiringPasswordEntry {
    pub entry_id: String,
    pub title: String,
    pub expires_at: String,
    pub status: String,
    pub days_until_expiry: i64,
}

struct AuditedCredential<'a> {
    entry_id: &'a str,
    title: &'a str,
    secret: &'a str,
}

// Offline security audit — passwords never leave this function's RAM footprint in the response.
pub fn audit_entries(entries: &[SecretEntry]) -> SecurityAuditReport {
    let credentials: Vec<AuditedCredential<'_>> = entries
        .iter()
        .filter_map(|entry| {
            extract_credential(entry).map(|secret| AuditedCredential {
                entry_id: &entry.id,
                title: &entry.title,
                secret,
            })
        })
        .collect();

    let total_audited = credentials.len();

    let mut weak_entries = Vec::new();
    for cred in &credentials {
        let reasons = weak_password_reasons(cred.secret);
        if !reasons.is_empty() {
            weak_entries.push(WeakPasswordEntry {
                entry_id: cred.entry_id.to_string(),
                title: cred.title.to_string(),
                reasons,
            });
        }
    }

    let mut by_secret: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    for cred in &credentials {
        by_secret
            .entry(cred.secret)
            .or_default()
            .push((cred.entry_id, cred.title));
    }

    let mut duplicate_groups = Vec::new();
    let mut duplicate_entry_count = 0usize;
    for group in by_secret.values() {
        if group.len() < 2 {
            continue;
        }
        duplicate_entry_count += group.len();
        duplicate_groups.push(DuplicatePasswordGroup {
            entry_ids: group.iter().map(|(id, _)| (*id).to_string()).collect(),
            titles: group
                .iter()
                .map(|(_, title)| (*title).to_string())
                .collect(),
            count: group.len(),
        });
    }
    duplicate_groups.sort_by_key(|b| std::cmp::Reverse(b.count));

    let mut expiring_entries = Vec::new();
    for entry in entries {
        let Some(expires_at) = entry.expires_at.as_deref() else {
            continue;
        };
        let Some(status) = expiry_status(expires_at) else {
            continue;
        };
        expiring_entries.push(ExpiringPasswordEntry {
            entry_id: entry.id.clone(),
            title: entry.title.clone(),
            expires_at: expires_at.to_string(),
            status: match status.kind {
                ExpiryStatusKind::Expired => "expired".into(),
                ExpiryStatusKind::ExpiringSoon => "expiring_soon".into(),
            },
            days_until_expiry: status.days_until_expiry,
        });
    }
    expiring_entries.sort_by_key(|a| a.days_until_expiry);

    let score_percent = if total_audited == 0 {
        100
    } else {
        compute_score(total_audited, weak_entries.len(), &duplicate_groups)
    };

    SecurityAuditReport {
        score_percent,
        total_audited,
        weak_count: weak_entries.len(),
        duplicate_group_count: duplicate_groups.len(),
        duplicate_entry_count,
        expiring_count: expiring_entries.len(),
        duplicate_groups,
        weak_entries,
        expiring_entries,
    }
}

fn extract_credential(entry: &SecretEntry) -> Option<&str> {
    match &entry.payload {
        SecretPayload::WebLogin { password, .. }
        | SecretPayload::Database { password, .. }
        | SecretPayload::NetworkWifi { password, .. } => Some(password.as_str()),
        SecretPayload::ApiToken { token, .. } => Some(token.as_str()),
        SecretPayload::SshKey {
            passphrase: Some(p),
            ..
        } if !p.is_empty() => Some(p.as_str()),
        SecretPayload::SshKey { .. } | SecretPayload::SecureNote { .. } => None,
    }
}

fn weak_password_reasons(password: &str) -> Vec<String> {
    let mut reasons = Vec::new();
    if password.len() < MIN_STORED_PASSWORD_LEN {
        reasons.push("short".into());
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        reasons.push("no_digit".into());
    }
    if !password.chars().any(|c| !c.is_ascii_alphanumeric()) {
        reasons.push("no_symbol".into());
    }
    reasons
}

fn compute_score(
    total: usize,
    weak_count: usize,
    duplicate_groups: &[DuplicatePasswordGroup],
) -> u8 {
    if total == 0 {
        return 100;
    }

    let weak_ratio = weak_count as f64 / total as f64;
    let weak_penalty = (weak_ratio * 45.0).min(45.0);

    let duplicate_excess: usize = duplicate_groups
        .iter()
        .map(|g| g.count.saturating_sub(1))
        .sum();
    let dup_penalty = (duplicate_excess as f64 * 8.0).min(45.0);

    let score = (100.0 - weak_penalty - dup_penalty).round();
    score.clamp(0.0, 100.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{SecretEntryInput, SecretPayload};
    use chrono::{Duration, Local};

    fn web_entry(title: &str, password: &str) -> SecretEntry {
        SecretEntry::from_input(SecretEntryInput {
            title: title.into(),
            folder: None,
            tags: vec![],
            expires_at: None,
            payload: SecretPayload::WebLogin {
                url: "https://example.com".into(),
                username: "u".into(),
                password: password.into(),
                notes: None,
            },
        })
        .unwrap()
    }

    fn web_entry_expiring(title: &str, password: &str, days_from_now: i64) -> SecretEntry {
        let date = (Local::now().date_naive() + Duration::days(days_from_now))
            .format("%Y-%m-%d")
            .to_string();
        SecretEntry::from_input(SecretEntryInput {
            title: title.into(),
            folder: None,
            tags: vec![],
            expires_at: Some(date),
            payload: SecretPayload::WebLogin {
                url: "https://example.com".into(),
                username: "u".into(),
                password: password.into(),
                notes: None,
            },
        })
        .unwrap()
    }

    #[test]
    fn detects_duplicate_passwords() {
        let entries = vec![
            web_entry("A", "same-secret-12!"),
            web_entry("B", "same-secret-12!"),
            web_entry("C", "unique-secret-99!"),
        ];
        let report = audit_entries(&entries);
        assert_eq!(report.duplicate_group_count, 1);
        assert_eq!(report.duplicate_groups[0].count, 2);
    }

    #[test]
    fn detects_weak_passwords() {
        let entries = vec![web_entry("Weak", "abc")];
        let report = audit_entries(&entries);
        assert_eq!(report.weak_count, 1);
        assert!(report.weak_entries[0].reasons.contains(&"short".into()));
    }

    #[test]
    fn detects_expiring_passwords() {
        let entries = vec![
            web_entry_expiring("Expired", "long-enough-1!", -3),
            web_entry_expiring("Soon", "long-enough-2!", 7),
            web_entry_expiring("Fine", "long-enough-3!", 30),
        ];
        let report = audit_entries(&entries);
        assert_eq!(report.expiring_count, 2);
        assert_eq!(report.expiring_entries.len(), 2);
    }

    #[test]
    fn empty_vault_scores_perfect() {
        let report = audit_entries(&[]);
        assert_eq!(report.score_percent, 100);
        assert_eq!(report.expiring_count, 0);
    }
}
