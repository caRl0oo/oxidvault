// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

mod clipboard;
mod commands;
mod git_sync;
mod native_messaging;
mod nm_bridge;
mod probe;
mod settings;
mod ssh;
mod window_events;

use commands::AppState;
use ssh::SshManager;
use tauri::Manager;
use vault_core::Vault;

/// Headless Native Messaging host for the browser extension (no WebView).
pub fn run_native_messaging() -> std::io::Result<()> {
    native_messaging::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            nm_bridge::spawn_server(app.handle().clone());
            Ok(())
        })
        .manage(AppState {
            vault: std::sync::Mutex::new(Vault::new()),
            ssh: SshManager::new(),
            clipboard: clipboard::SecureClipboard::new(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_vault_info,
            commands::create_vault,
            commands::open_vault,
            commands::unlock_vault,
            commands::complete_unlock_vault,
            commands::cancel_pending_unlock,
            commands::lock_vault,
            commands::list_entries,
            commands::add_entry,
            commands::update_entry,
            commands::get_entry,
            commands::reveal_secret,
            commands::copy_to_clipboard,
            commands::generate_password_cmd,
            commands::bootstrap::bootstrap_vault,
            commands::bootstrap::detach_vault,
            commands::open_url::open_website_url,
            commands::reachability::check_entries_reachability,
            commands::audit::audit_vault_security,
            commands::audit::get_audit_logs,
            commands::audit::export_audit_log,
            commands::git_sync::get_app_settings,
            commands::git_sync::update_git_sync_settings,
            commands::git_sync::sync_vault_git,
            commands::policy::get_resolved_config,
            commands::compliance::get_compliance_status,
            commands::compliance::reencrypt_vault,
            commands::diagnostics::get_system_diagnostics,
            commands::enable_mfa,
            commands::get_mfa_status,
            commands::disable_mfa,
            commands::verify_mfa_code,
            commands::ssh_connect,
            commands::ssh::ssh_write,
            commands::ssh::ssh_disconnect,
        ])
        .on_window_event(|window, event| {
            if let Some(state) = window.try_state::<AppState>() {
                window_events::on_main_window_event(window, event, &state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OxidVault");
}
