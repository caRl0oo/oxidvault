# Contributing to OxidVault

Thank you for your interest in contributing to OxidVault!

## License Agreement (CLA)

OxidVault uses a dual-licensing model:
- Community Edition: AGPLv3 (open source)
- Enterprise Edition: Commercial license

**By submitting a pull request or any contribution, you agree that:**

1. Your contribution is licensed under AGPL-3.0-only
2. You grant Pascal Kuhn a perpetual, irrevocable, worldwide license
   to use your contribution under a commercial license as part of
   the OxidVault Enterprise Edition

This is required to maintain the dual-licensing model.
If you do not agree, please do not submit contributions.

## Reporting Security Issues

Please do **not** open public GitHub issues for security vulnerabilities.

Report security issues directly to: **security@oxidvault.de**

We aim to respond within 48 hours and will coordinate a responsible
disclosure timeline with you before any details are published.

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes with clear messages
4. Open a pull request with a description of what and why

## Code Standards

- Rust: `cargo fmt` + `cargo clippy` must pass without warnings
- TypeScript: existing ESLint configuration must pass
- All new Tauri commands must be documented in `ARCHITECTURE.md`
- Security-relevant changes require an update to the
  Speichersicherheit table in `ARCHITECTURE.md §3`
