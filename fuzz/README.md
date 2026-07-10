# OxidVault — cargo-fuzz

Continuous fuzzing of untrusted-input parsers in `vault-core` using [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer).

**Platform:** Linux or WSL2 with Rust **nightly** (`rustup toolchain install nightly`).

## Prerequisites

```bash
cargo install cargo-fuzz
rustup toolchain install nightly
```

## Targets

| Target | Entry point | What is exercised |
|---|---|---|
| `vault_format` | `vault_core::parse_vault_file_bytes` | v4 magic, header, `users_json` (+ base64 fields), payload split |
| `audit_log` | `parse_audit_log_bytes` + `verify_audit_chain_bytes` | Line parse, hash-chain verification |
| `ssh_key` | `parse_ssh_private_key_bytes` | PEM/PPK normalization, envelope checks, key-type classification |

## Run

From the repository root:

```bash
cd fuzz
cargo +nightly fuzz run vault_format -- -max_total_time=60
cargo +nightly fuzz run audit_log -- -max_total_time=60
cargo +nightly fuzz run ssh_key -- -max_total_time=60
```

Seed corpora live under `fuzz/corpus/<target>/`.

## Crashes & reproduction

Crashes are written to `fuzz/artifacts/<target>/`. To replay a single input:

```bash
cd fuzz
cargo +nightly fuzz run vault_format artifacts/vault_format/crash-<id>
```

Replace `vault_format` and the artifact path for other targets.

## Workspace isolation

The `fuzz/` crate is excluded from the root workspace (`exclude = ["fuzz"]` in the root `Cargo.toml`). Main-workspace `cargo test`, `clippy`, and `fmt` are unaffected.

## Refreshing corpus seeds

```bash
cargo test -p vault-core write_fuzz -- --ignored --nocapture
```

This writes fixtures into `fuzz/corpus/vault_format/`, `fuzz/corpus/audit_log/`, and `fuzz/corpus/ssh_key/`.

SSH seeds are **structural skeletons only** (no real private key material) so static secret scanners stay quiet. Regenerate after parser changes.
