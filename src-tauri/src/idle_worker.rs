// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use vault_core::policy::resolve_config;
use vault_core::VaultInfo;

use crate::commands::perform_lock;
use crate::settings;
use crate::state::AppState;

pub const IDLE_WARNING_SECONDS: u64 = 30;
const TICK_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultLockedPayload {
    pub reason: String,
    pub info: VaultInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_lock_seconds: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleWarningPayload {
    pub seconds_remaining: u64,
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(TICK_INTERVAL);
        loop {
            interval.tick().await;
            if let Some(state) = app.try_state::<AppState>() {
                tick(&app, &state);
            }
        }
    });
}

fn tick(app: &AppHandle, state: &AppState) {
    if !state.is_vault_unlocked() {
        state.clear_idle_warning();
        return;
    }

    let timeout_secs = resolve_auto_lock_seconds(app);
    if timeout_secs == 0 {
        state.clear_idle_warning();
        return;
    }

    let timeout = Duration::from_secs(u64::from(timeout_secs));
    let elapsed = state.elapsed_since_activity();
    let warning_threshold = timeout.saturating_sub(Duration::from_secs(IDLE_WARNING_SECONDS));

    if elapsed >= timeout {
        state.clear_idle_warning();
        if let Ok(info) = perform_lock(state) {
            let _ = app.emit(
                "vault-locked",
                VaultLockedPayload {
                    reason: "idle".into(),
                    info,
                    auto_lock_seconds: Some(timeout_secs),
                },
            );
        }
        return;
    }

    if elapsed >= warning_threshold {
        if state.try_mark_idle_warning_sent() {
            let _ = app.emit(
                "vault-idle-warning",
                IdleWarningPayload {
                    seconds_remaining: IDLE_WARNING_SECONDS,
                },
            );
        }
    } else {
        state.clear_idle_warning();
    }
}

fn resolve_auto_lock_seconds(app: &AppHandle) -> u32 {
    settings::load_settings(app)
        .map(|user_settings| {
            resolve_config(&user_settings.policy_preferences())
                .auto_lock_seconds
                .value
        })
        .unwrap_or(120)
}
