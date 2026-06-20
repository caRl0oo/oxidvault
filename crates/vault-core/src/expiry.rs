use chrono::{Local, NaiveDate};

pub const EXPIRY_WARN_DAYS: i64 = 14;
pub const DATE_FORMAT: &str = "%Y-%m-%d";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpiryStatusKind {
    Expired,
    ExpiringSoon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpiryStatus {
    pub kind: ExpiryStatusKind,
    /// Calendar days until expiry; negative when already expired.
    pub days_until_expiry: i64,
}

/// Parses a calendar date in `YYYY-MM-DD` form (no timezone component).
pub fn parse_expiry_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), DATE_FORMAT).ok()
}

pub fn today_local() -> NaiveDate {
    Local::now().date_naive()
}

/// Returns warning status when expired or within [`EXPIRY_WARN_DAYS`].
pub fn expiry_status(expires_at: &str) -> Option<ExpiryStatus> {
    let expiry = parse_expiry_date(expires_at)?;
    let days = (expiry - today_local()).num_days();
    if days < 0 {
        Some(ExpiryStatus {
            kind: ExpiryStatusKind::Expired,
            days_until_expiry: days,
        })
    } else if days <= EXPIRY_WARN_DAYS {
        Some(ExpiryStatus {
            kind: ExpiryStatusKind::ExpiringSoon,
            days_until_expiry: days,
        })
    } else {
        None
    }
}

pub fn normalize_expires_at(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        parse_expiry_date(trimmed).map(|date| date.format(DATE_FORMAT).to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_date() {
        assert!(parse_expiry_date("2026-12-31").is_some());
        assert!(parse_expiry_date("2026-13-01").is_none());
    }

    #[test]
    fn normalize_rejects_invalid() {
        assert!(normalize_expires_at(Some("not-a-date".into())).is_none());
        assert_eq!(
            normalize_expires_at(Some(" 2026-06-01 ".into())).as_deref(),
            Some("2026-06-01")
        );
    }
}
