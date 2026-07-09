# OxidVault License Generator

Internal maintainer tool for signing Enterprise Edition license files (Ed25519, offline validation).

The source code is safe to keep in version control. **License issuance requires the private signing key**, which must never be committed or shared. Without that key, third parties cannot generate valid licenses.

## Security model

| Asset | Secret? | Storage |
|---|---|---|
| Private signing key (`oxidvault_private.key`) | Yes | Password manager or secure offline backup only |
| Public verification key | No | Embedded at build time via `OXIDVAULT_PUBLIC_KEY` |
| Customer `.license` files | Customer-specific | Delivered per customer; never commit to Git |

`.gitignore` already excludes `*.key`, `*.license`, and `oxidvault_private.key`.

## Prerequisites

- Rust toolchain (workspace member: run from repository root)
- `chrono` date format `YYYY-MM-DD` for license expiry

## One-time setup

### 1. Generate an Ed25519 keypair

```bash
cargo run -p license-generator -- generate-keypair \
  --output oxidvault_private.key
```

The command writes the private key to disk and prints the base64-encoded public key for the next step.

### 2. Protect the private key

- Do not commit it to Git or include it in distribution packages
- Store it in a password manager or other secure secret storage
- Maintain an offline backup for disaster recovery

### 3. Embed the public key in release builds

The public key is compiled into the application binary. It can verify signatures only; it cannot issue licenses.

**Windows (PowerShell, current session):**

```powershell
$env:OXIDVAULT_PUBLIC_KEY = "<public-key-base64-from-step-1>"
cargo build --release
```

**Linux / macOS:**

```bash
export OXIDVAULT_PUBLIC_KEY="<public-key-base64-from-step-1>"
cargo build --release
```

If `OXIDVAULT_PUBLIC_KEY` is unset, the build falls back to Community Edition mode (no verification key embedded).

## Issue a license

```bash
cargo run -p license-generator -- generate \
  --licensee "Acme GmbH" \
  --plan enterprise \
  --max-users 0 \
  --valid-until 2027-12-31 \
  --private-key oxidvault_private.key \
  --output acme-gmbh.license
```

| Flag | Description |
|---|---|
| `--plan` | `enterprise` or `community` |
| `--max-users` | `0` = unlimited (Enterprise); positive integer = cap |
| `--valid-until` | Expiry date (`YYYY-MM-DD`) |

## Customer deployment

1. Deliver the signed `.license` file to the customer (e.g. secure email or support portal).
2. Customer places the file at:
   - **Windows:** `C:\ProgramData\OxidVault\oxidvault.license`
   - **Linux:** `/etc/oxidvault/oxidvault.license`
3. Customer restarts OxidVault — Enterprise features activate after offline signature verification.

## Related documentation

- License format and verification: [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (Enterprise Edition / license section)
- Application-side validation: `crates/vault-core/src/license.rs`
