// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

fn main() {
    // Public key injected at build time via environment variable
    // Never hardcoded in source — safe for open source repository
    if let Ok(key) = std::env::var("OXIDVAULT_PUBLIC_KEY") {
        if !key.is_empty() {
            println!("cargo:rustc-env=OXIDVAULT_PUBLIC_KEY={key}");
            return;
        }
    }

    // No key set — license validation will always fail gracefully
    // App falls back to Community Edition
    println!("cargo:rustc-env=OXIDVAULT_PUBLIC_KEY=");
    println!(
        "cargo:warning=OXIDVAULT_PUBLIC_KEY not set \
         — license validation disabled, CE mode only"
    );
}
