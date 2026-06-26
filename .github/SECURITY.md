# Security Policy

## Reporting a Vulnerability

Please do **not** open public GitHub issues for security vulnerabilities.

Report security issues confidentially to: **security@oxidvault.de**

Please include:
- Affected version and platform
- Steps to reproduce
- Proof of concept (if available)

We aim to respond within **48 hours** and will coordinate a responsible
disclosure timeline before any details are published.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅        |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Cryptographic Design

OxidVault uses:
- **Argon2id** (m=64MiB, t=3, p=4) for key derivation
- **AES-256-GCM** for vault encryption
- **TOTP RFC 6238** for MFA (offline)
- **zeroize** for secure memory cleanup

Full specification: [ARCHITECTURE.md](../ARCHITECTURE.md)
