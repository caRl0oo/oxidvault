// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

fn main() {
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "debug" && std::env::var("OXIDVAULT_LICENSE_KEY").is_err() {
        println!(
            "cargo:warning=OxidVault: set OXIDVAULT_LICENSE_KEY or deploy license_hmac.key for license validation"
        );
    }
}
