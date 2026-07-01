// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

mod clipboard;
mod commands;
mod git;
mod idle_worker;
mod native_messaging;
mod nm_bridge;
mod probe;
mod settings;
mod ssh;
mod state;
mod system_tray;
mod window_events;

use state::AppState;
use tauri::{Manager, RunEvent};

/// Headless Native Messaging host for the browser extension (no WebView).
pub fn run_native_messaging() -> std::io::Result<()> {
    native_messaging::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            system_tray::setup_tray(app.handle())?;
            nm_bridge::spawn_server(app.handle().clone());
            idle_worker::spawn(app.handle().clone());
            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_vault_info,
            commands::create_vault,
            commands::open_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::quit_app,
            commands::list_entries,
            commands::add_entry,
            commands::update_entry,
            commands::delete_entry,
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
            commands::git_sync::mark_import_offered,
            commands::git_sync::update_auto_lock_seconds,
            commands::git_sync::update_git_sync_settings,
            commands::git_sync::trigger_git_sync,
            commands::git_sync::sync_vault_git,
            commands::git_sync::save_ssh_passphrase,
            commands::git_sync::remove_ssh_passphrase,
            commands::policy::get_resolved_config,
            commands::compliance::get_compliance_status,
            commands::compliance::reencrypt_vault,
            commands::diagnostics::get_system_diagnostics,
            commands::enable_mfa,
            commands::get_mfa_status,
            commands::disable_mfa,
            commands::verify_mfa_code,
            commands::take_extension_new_secret,
            commands::touch_activity,
            commands::ssh_connect,
            commands::ssh::ssh_begin_streaming,
            commands::ssh::ssh_write,
            commands::ssh::ssh_resize_pty,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_trust_host,
            commands::ssh::ssh_reject_host,
            commands::ssh::ssh_clear_host_fingerprint,
            commands::users::attach_vault_path,
            commands::users::create_vault_v3,
            commands::users::unlock_vault_as_user,
            commands::users::list_vault_users,
            commands::users::add_vault_user,
            commands::users::remove_vault_user,
            commands::users::change_user_password,
            commands::users::migrate_vault_to_v3,
            commands::users::get_license_info,
            commands::users::get_current_user,
            system_tray::sync_tray_locale,
        ])
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if let Some(state) = app.try_state::<AppState>() {
                window_events::on_main_window_event(window, event, &state);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running OxidVault")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
