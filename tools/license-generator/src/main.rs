// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use clap::Parser;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;

fn get_hmac_key() -> Vec<u8> {
    if let Ok(key) = std::env::var("OXIDVAULT_LICENSE_KEY") {
        return key.into_bytes();
    }

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    let key_path = std::path::Path::new(&home).join(".oxidvault_license_key");

    if let Ok(key) = std::fs::read_to_string(&key_path) {
        return key.trim().as_bytes().to_vec();
    }

    eprintln!("❌ HMAC key not found!");
    eprintln!("   Set OXIDVAULT_LICENSE_KEY environment variable");
    eprintln!("   or create ~/.oxidvault_license_key");
    std::process::exit(1);
}

#[derive(Parser)]
#[command(
    name = "license-generator",
    about = "OxidVault License Generator — internal use only",
    long_about = None
)]
struct Args {
    /// Company name (licensee)
    #[arg(short, long)]
    licensee: String,

    /// License plan: community or enterprise
    #[arg(short, long, default_value = "enterprise")]
    plan: String,

    /// Max users (0 = unlimited, 5 = CE limit)
    #[arg(short, long, default_value = "0")]
    max_users: u32,

    /// Valid until date (YYYY-MM-DD)
    #[arg(short, long)]
    valid_until: String,

    /// Output file path
    #[arg(short, long, default_value = "oxidvault.license")]
    output: String,
}

#[derive(Serialize)]
struct LicenseFile {
    licensee: String,
    plan: String,
    max_users: u32,
    valid_until: String,
    issued_at: String,
    signature: String,
}

fn main() {
    let args = Args::parse();

    if args.plan != "community" && args.plan != "enterprise" {
        eprintln!("❌ Error: plan must be 'community' or 'enterprise'");
        std::process::exit(1);
    }

    if chrono::NaiveDate::parse_from_str(&args.valid_until, "%Y-%m-%d").is_err() {
        eprintln!("❌ Error: valid_until must be YYYY-MM-DD (e.g. 2027-06-25)");
        std::process::exit(1);
    }

    let hmac_key = get_hmac_key();
    let issued_at = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let payload = format!(
        "{}|{}|{}|{}|{}",
        args.licensee, args.plan, args.max_users, args.valid_until, issued_at,
    );

    let mut mac = Hmac::<Sha256>::new_from_slice(&hmac_key).expect("HMAC key error");
    mac.update(payload.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());

    let license = LicenseFile {
        licensee: args.licensee.clone(),
        plan: args.plan.clone(),
        max_users: args.max_users,
        valid_until: args.valid_until.clone(),
        issued_at: issued_at.clone(),
        signature,
    };

    let json = serde_json::to_string_pretty(&license).expect("Serialization error");

    std::fs::write(&args.output, &json).expect("Could not write license file");

    println!("✅ License generated successfully");
    println!("   Licensee:    {}", args.licensee);
    println!("   Plan:        {}", args.plan);
    println!(
        "   Max users:   {}",
        if args.max_users == 0 {
            "unlimited".to_string()
        } else {
            args.max_users.to_string()
        }
    );
    println!("   Valid until: {}", args.valid_until);
    println!("   Issued at:   {}", issued_at);
    println!("   Output:      {}", args.output);
    println!();
    println!("📋 Customer deployment:");
    println!("   Windows: C:\\ProgramData\\OxidVault\\oxidvault.license");
    println!("   Linux:   /etc/oxidvault/oxidvault.license");
}
