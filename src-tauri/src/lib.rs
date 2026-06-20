mod commands;
mod clipboard;
mod git_sync;
mod probe;
mod settings;
mod ssh;
mod window_events;

use commands::AppState;
use ssh::SshManager;
use tauri::Manager;
use vault_core::Vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
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
            commands::git_sync::get_app_settings,
            commands::git_sync::update_git_sync_settings,
            commands::git_sync::sync_vault_git,
            commands::ssh_connect,
            commands::ssh::ssh_write,
            commands::ssh::ssh_disconnect,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("main window");
                window.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let Some(state) = window.try_state::<AppState>() {
                window_events::on_main_window_event(window, event, &state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OxidVault");
}
