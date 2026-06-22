// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use serde::Serialize;
use tauri::State;

use crate::commands::AppState;
use crate::probe::tcp_reachable;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryReachabilityStatus {
    pub entry_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_entries_reachability(
    entry_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<EntryReachabilityStatus>, String> {
    let targets: Vec<(String, String, u16)> = {
        let vault = state.vault.lock().map_err(|e| e.to_string())?;
        let mut resolved = Vec::new();
        for id in entry_ids {
            match vault.probe_target_for_entry(&id) {
                Some(target) => {
                    resolved.push((id, target.host, target.port));
                }
                None => {
                    resolved.push((id, String::new(), 0));
                }
            }
        }
        resolved
    };

    let mut handles = Vec::new();
    for (entry_id, host, port) in targets {
        if host.is_empty() || port == 0 {
            handles.push(tokio::spawn(async move {
                EntryReachabilityStatus {
                    entry_id,
                    status: "unsupported".into(),
                    host: None,
                    port: None,
                    error: None,
                }
            }));
            continue;
        }
        handles.push(tokio::spawn(async move {
            let online = tcp_reachable(&host, port).await;
            EntryReachabilityStatus {
                entry_id,
                status: if online { "online" } else { "offline" }.into(),
                host: Some(host),
                port: Some(port),
                error: None,
            }
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(status) => results.push(status),
            Err(_) => {
                // Join failure — treat as offline, never crash the command.
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn tcp_unreachable_host_returns_false() {
        assert!(!crate::probe::tcp_reachable("203.0.113.1", 9).await);
    }
}
