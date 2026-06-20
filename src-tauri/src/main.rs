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

    oxidvault_lib::run();
}
