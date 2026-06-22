// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
