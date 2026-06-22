// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

//! Console binary for Chrome/Edge Native Messaging on Windows.
//!
//! The GUI binary (`oxidvault.exe`) uses `windows_subsystem = "windows"` in release,
//! which can break stdin/stdout pipes when the browser spawns the host process.
//! This dedicated entry point stays a console application so framed JSON on stdout
//! reaches the extension reliably.

fn main() {
    if let Err(err) = oxidvault_lib::run_native_messaging() {
        eprintln!("native messaging host failed: {err}");
        std::process::exit(1);
    }
}
