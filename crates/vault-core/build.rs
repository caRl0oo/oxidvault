// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

fn main() {
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "debug" {
        println!(
            "cargo:warning=OxidVault: LICENSE_HMAC_KEY is a placeholder — replace before production release"
        );
    }
}
