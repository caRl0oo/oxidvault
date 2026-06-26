// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

use base64::Engine;
use clap::{Parser, Subcommand};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use serde::Serialize;

#[derive(Parser)]
#[command(
    name = "license-generator",
    about = "OxidVault License Generator — internal use only"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a new Ed25519 keypair (run once)
    GenerateKeypair {
        #[arg(short, long, default_value = "oxidvault_private.key")]
        output: String,
    },
    /// Generate a signed license file
    Generate(GenerateArgs),
}

#[derive(Parser)]
struct GenerateArgs {
    #[arg(short, long)]
    licensee: String,

    #[arg(short, long, default_value = "enterprise")]
    plan: String,

    #[arg(short, long, default_value = "0")]
    max_users: u32,

    #[arg(short, long)]
    valid_until: String,

    #[arg(long, default_value = "oxidvault_private.key")]
    private_key: String,

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
    let cli = Cli::parse();

    match cli.command {
        Commands::GenerateKeypair { output } => {
            generate_keypair(&output);
        }
        Commands::Generate(args) => {
            generate_license(&args);
        }
    }
}

fn generate_keypair(output: &str) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let private_b64 = base64::engine::general_purpose::STANDARD.encode(signing_key.to_bytes());
    std::fs::write(output, &private_b64).expect("Could not write private key file");

    let public_b64 = base64::engine::general_purpose::STANDARD.encode(verifying_key.to_bytes());

    println!("✅ Ed25519 keypair generated");
    println!();
    println!("🔑 Private key saved to: {output}");
    println!("   Keep this SECRET — never commit, never share");
    println!("   Store in your password manager (OxidVault 😄)");
    println!();
    println!("📋 Public key — set as build environment variable:");
    println!();
    println!("   $env:OXIDVAULT_PUBLIC_KEY = \"{public_b64}\"");
    println!("   cargo build --release");
    println!();
    println!("   The public key will be embedded in the binary.");
    println!("   It is NOT a secret — safe to embed.");
    println!();
    println!("⚠️  Add private key to .gitignore: {output}");
}

fn generate_license(args: &GenerateArgs) {
    if args.plan != "community" && args.plan != "enterprise" {
        eprintln!("❌ Error: plan must be 'community' or 'enterprise'");
        std::process::exit(1);
    }

    if chrono::NaiveDate::parse_from_str(&args.valid_until, "%Y-%m-%d").is_err() {
        eprintln!("❌ Error: valid_until must be YYYY-MM-DD");
        std::process::exit(1);
    }

    let private_b64 = std::fs::read_to_string(&args.private_key).unwrap_or_else(|_| {
        eprintln!("❌ Could not read private key: {}", args.private_key);
        eprintln!("   Run 'generate-keypair' first");
        std::process::exit(1);
    });

    let private_bytes = base64::engine::general_purpose::STANDARD
        .decode(private_b64.trim())
        .unwrap_or_else(|_| {
            eprintln!("❌ Invalid base64 in private key file");
            std::process::exit(1);
        });

    let private_array: [u8; 32] = private_bytes.try_into().unwrap_or_else(|_| {
        eprintln!("❌ Invalid key length — expected 32 bytes");
        std::process::exit(1);
    });

    let signing_key = SigningKey::from_bytes(&private_array);
    let issued_at = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let payload = format!(
        "{}|{}|{}|{}|{}",
        args.licensee, args.plan, args.max_users, args.valid_until, issued_at,
    );

    let signature = signing_key.sign(payload.as_bytes());
    let signature_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

    let license = LicenseFile {
        licensee: args.licensee.clone(),
        plan: args.plan.clone(),
        max_users: args.max_users,
        valid_until: args.valid_until.clone(),
        issued_at,
        signature: signature_b64,
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
    println!("   Output:      {}", args.output);
    println!();
    println!("📋 Customer deployment:");
    println!("   Windows: C:\\ProgramData\\OxidVault\\oxidvault.license");
    println!("   Linux:   /etc/oxidvault/oxidvault.license");
}
