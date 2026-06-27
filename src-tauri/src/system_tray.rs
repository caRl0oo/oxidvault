// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use vault_core::VaultInfo;

use crate::commands::perform_lock;
use crate::idle_worker::VaultLockedPayload;
use crate::state::AppState;

pub const TRAY_ID: &str = "main-tray";

struct TrayLocaleState {
    locale: Mutex<String>,
}

struct TrayMenuLabels {
    status_locked: &'static str,
    status_unlocked: &'static str,
    show: &'static str,
    lock: &'static str,
    quit: &'static str,
}

fn labels_for_locale(locale: &str) -> TrayMenuLabels {
    if locale.starts_with("en") {
        TrayMenuLabels {
            status_locked: "🔒 Vault locked",
            status_unlocked: "🔓 Vault unlocked",
            show: "Open OxidVault",
            lock: "Lock vault",
            quit: "Quit",
        }
    } else {
        TrayMenuLabels {
            status_locked: "🔒 Vault gesperrt",
            status_unlocked: "🔓 Vault entsperrt",
            show: "OxidVault öffnen",
            lock: "Vault sperren",
            quit: "Beenden",
        }
    }
}

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<TrayLocaleState>()
        .and_then(|state| state.locale.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_else(|| "de".into())
}

pub fn set_tray_locale(app: &AppHandle, locale: String) {
    let normalized = if locale.starts_with("en") {
        "en".to_string()
    } else {
        "de".to_string()
    };

    if let Some(state) = app.try_state::<TrayLocaleState>() {
        if let Ok(mut guard) = state.locale.lock() {
            *guard = normalized;
        }
    }

    let locked = app
        .try_state::<AppState>()
        .map(|state| !state.is_vault_unlocked())
        .unwrap_or(true);
    let _ = update_tray_menu(app, locked);
}

fn build_tray_menu(app: &AppHandle, locked: bool) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let labels = labels_for_locale(&current_locale(app));
    let status_text = if locked {
        labels.status_locked
    } else {
        labels.status_unlocked
    };

    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", labels.show, true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", labels.lock, !locked, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &status,
            &separator,
            &show,
            &lock,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

pub fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    app.manage(TrayLocaleState {
        locale: Mutex::new("de".into()),
    });

    let icon = app
        .default_window_icon()
        .expect("default window icon must be configured in tauri.conf.json")
        .clone();
    let menu = build_tray_menu(app, true)?;
    let app_handle = app.clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("OxidVault")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| handle_tray_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(move |_tray, event| handle_tray_icon_event(&app_handle, event))
        .build(app)?;

    Ok(())
}

fn handle_tray_icon_event(app: &AppHandle, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
        | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            show_main_window(app);
        }
        _ => {}
    }
}

fn handle_tray_menu_event(app: &AppHandle, item_id: &str) {
    match item_id {
        "show" => show_main_window(app),
        "lock" => lock_from_tray(app),
        "quit" => quit_from_tray(app),
        _ => {}
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn lock_from_tray(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    match perform_lock(&state) {
        Ok(info) => {
            let _ = update_tray_menu(app, true);
            let _ = app.emit(
                "vault-locked",
                VaultLockedPayload {
                    reason: "manual".into(),
                    info,
                    auto_lock_seconds: None,
                },
            );
        }
        Err(err) => log::warn!("tray lock failed: {err}"),
    }
}

fn quit_from_tray(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = perform_lock(&state);
    }
    // Bypass RunEvent::ExitRequested prevent_exit (hide-to-tray) — hard exit.
    std::process::exit(0);
}

pub fn update_tray_menu(app: &AppHandle, locked: bool) -> Result<(), tauri::Error> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    let menu = build_tray_menu(app, locked)?;
    tray.set_menu(Some(menu))?;
    Ok(())
}

pub fn notify_vault_locked(app: &AppHandle, info: &VaultInfo) {
    let _ = update_tray_menu(app, info.locked);
}

pub fn notify_vault_unlocked(app: &AppHandle) {
    let _ = update_tray_menu(app, false);
}

#[tauri::command]
pub fn sync_tray_locale(app: AppHandle, locale: String) {
    set_tray_locale(&app, locale);
}
