// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    init_dev_logging();

    if std::env::args().any(|arg| arg == "--native-messaging") {
        if let Err(err) = oxidvault_lib::run_native_messaging() {
            eprintln!("native messaging host failed: {err}");
            std::process::exit(1);
        }
        return;
    }

    if let Err(err) = vault_core::audit::init() {
        eprintln!("OxidVault compliance error: audit log security init failed: {err}");
        std::process::exit(1);
    }

    if let Err(err) = vault_core::policy::init_admin_policy() {
        eprintln!("OxidVault policy error: admin policy init failed: {err}");
        std::process::exit(1);
    }

    oxidvault_lib::run();
}

/// Enables `log` output in the dev console (`npm run tauri:dev`).
/// Set `RUST_LOG=oxidvault_lib::git=debug` for verbose git/keyring traces.
fn init_dev_logging() {
    #[cfg(debug_assertions)]
    {
        let _ = env_logger::Builder::from_env(
            env_logger::Env::default().default_filter_or("info,oxidvault_lib::git=debug"),
        )
        .try_init();
    }
}
