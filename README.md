# OxidVault

![Rust](https://img.shields.io/badge/Rust-1.85%2B-orange?logo=rust&logoColor=white) ![License](https://img.shields.io/badge/License-AGPL--3.0-blue) ![Version](https://img.shields.io/badge/Version-2.3.0-blue) ![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey) ![Website](https://img.shields.io/badge/Website-oxidvault.com-purple)

If you find OxidVault useful, consider giving it a ⭐ — it helps others discover the project.

## Feedback & Community

OxidVault is already used in the wild — **200+ repository clones** and growing. Your input shapes what we build next.

Help us improve with low-effort participation on GitHub:

- **[Open an issue](https://github.com/caRl0oo/oxidvault/issues)** — report a feature request, workflow friction, or something that slowed you down. Short notes are welcome; you do not need a full spec.
- **React with 👍 on existing issues** — if an idea matches your needs, a thumbs-up is enough for us to gauge demand and prioritize without long comment threads.

→ **[GitHub Issues](https://github.com/caRl0oo/oxidvault/issues)**

**Secure, on-premise password manager for enterprise environments.**

OxidVault is designed for organizations that want to operate credentials and secrets **entirely under their own control** — without cloud dependency, without third-party hosting, and with traceable compliance paths. The application combines a memory-safe Rust core with a lean desktop interface and is built for IT administrators, security officers (CISO), and end users in corporate environments.

---

## About OxidVault

OxidVault is an **Offline-First** vault for passwords, SSH access, and other secrets. Vault files (`.oxid`) can be stored locally or on **network drives (UNC paths)** — ideal for centralized team vaults in AD environments.

| Principle | What it means for your organization |
|---|---|
| **On-Premise** | No cloud sync, no third-party infrastructure |
| **Zero-Knowledge** | Master password and secret payloads remain in the Rust backend; plaintext is not persisted in the UI layer |
| **Governance-ready** | Central policies via policy file, auditable events, compliance dashboard |
| **Operationally safe** | Atomic writes, exclusive file locking, key rotation without payload re-encryption |
| **MFA-protected** | TOTP (RFC 6238) as a second factor; atomic unlock without intermediate RAM states |
| **Multi-User** | Up to 5 users per vault (CE) — each with their own password and MFA; shared DEK architecture |
| **Commercial license** | Enterprise Edition for unlimited users, LDAP, SSO — [oxidvault.com](https://oxidvault.com) |

Detailed technical specifications: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Security & Architecture

OxidVault is designed as a **memory-safe, offline-capable vault**. Security decisions are enforced in the Rust core (`vault-core`) — the React interface is a pure presentation layer with no access to key material.

### Offline-First & Local Sovereignty

- **No cloud dependency** — Vault files (`.oxid`) remain entirely under your control (local, UNC path, optional Git sync of the *encrypted* file).
- **No third-party hosting** — Secrets are not transmitted to external providers; autofill integrations (browser extension) use controlled native messaging channels.
- **On-premise by design** — suitable for AD environments, isolated networks, and regulated industries.

### Two-Factor Authentication (TOTP / MFA)

- **RFC 6238** — time-based one-time passwords (TOTP) fully validatable **offline**; no SMS gateway, no OAuth provider.
- **Enrollment in settings** — CSPRNG secret, QR code (otpauth URI), encrypted persistence in the vault payload (AES-256-GCM).
- **Unlock flow** — after the correct master password, the MFA challenge appears; auto-focus, auto-submit, and **UI-side rate limiting** (3 failed attempts → 30 s lockout) make brute-force attempts on the desktop harder.

### Multi-User Vaults (Format v3)

OxidVault supports shared vaults with multiple users — without a central server.

- **Own password per user** — no shared master password
- **Own TOTP per user** — MFA is bound to the person, not the vault
- **Shared DEK architecture** — one shared Data-Encryption-Key, wrapped per user with their KEK; password rotation for one user does not affect others
- **Roles** — `Admin` (manage users) and `Member` (read/write secrets)
- **Migration** — existing v1/v2 vaults can be migrated to v3 in a one-time operation; the previous master password becomes the first admin user

Community Edition: up to **5 users** per vault.  
Enterprise Edition: unlimited users — [oxidvault.com](https://oxidvault.com)

### Atomic Unlock

The vault **cannot** be opened with the master password alone when MFA is active:

```
Passwort ──► KEK-Ableitung (Argon2id) ──► Payload-Entschlüsselung (ephemer)
                    │
                    ▼
            MFA aktiv? ──Nein──► VaultHandle committen ──► entsperrt
                    │
                   Ja
                    ▼
            mfa_code vorhanden & gültig? ──Nein──► AuthError (kein Commit)
                    │
                   Ja
                    ▼
            Keys & Einträge erst jetzt in Vault-Session
```

- Central function: `vault-core/src/auth.rs` → `unlock_vault(password, mfa_code)` → `VaultHandle` | `AuthError`
- **No `PendingUnlock`** — on `MfaRequired`, `InvalidPassword`, or `InvalidMfa`, **nothing** is committed to the live `Vault` session.
- Decrypted data exists only in **ephemeral stack memory** during verification and is explicitly zeroized on abort.

### Zero-Knowledge & Memory Protection

| Aspect | Implementation |
|---|---|
| Master password | Used only for KEK derivation; `Zeroizing<String>` at IPC boundaries |
| MFA codes | `Zeroizing<String>`; not persisted |
| Locked vault | `master_key`, `kek`, entries, and plaintext secrets are removed from RAM |
| Lock / Close | `zeroize` on all cryptographic buffers and secret fields |
| IPC | No persistent plaintext transfer — metadata via `SecretEntryPublic`; reveal/clipboard intentionally one-shot |

> Even in the locked state, **no decrypted secrets** remain in the active vault session.

### Enterprise Interface & Operations

- **Modular theme system** — Oxid Default, Oxid Light, Dracula, Nord, and more; semantic design tokens (`vault-accent`, `vault-danger`, …) for consistent presentation in light, dark, and high-contrast environments.
- **Admin policy (GPO-style)** — central requirements for password length, auto-lock, UI locks.
- **Audit & compliance** — append-only audit log with hash chain, export for auditors, compliance dashboard.

### Relevant Modules (Excerpt)

| Module / Component | Responsibility |
|---|---|
| `crates/vault-core/src/auth.rs` | Atomic authentication (`AuthError`, `VaultHandle`, `unlock_vault`) |
| `crates/vault-core/src/mfa.rs` | TOTP enrollment, verification (RFC 6238), encrypted MFA secret storage |
| `crates/vault-core/src/crypto.rs` | Argon2id, AES-256-GCM, `MasterKey`, Zeroizing |
| `src/hooks/useMfaRateLimit.ts` | UI rate limiting for MFA failed attempts (lockout + countdown) |
| `src/components/screens/AuthForm.tsx` | Unlock modal with dynamic MFA challenge |
| `src-tauri/src/commands/` | IPC bridge; `Zeroizing` for passwords and MFA codes |

---

## Key Features

### Enterprise Governance

Central control via an **admin policy file** in GPO style. IT administrators define binding requirements (e.g. minimum master password length, auto-lock, lock on minimize) that end users cannot override.

| Platform | Policy path |
|---|---|
| Windows | `C:\ProgramData\OxidVault\policy.json` |
| Linux / macOS | `/etc/oxidvault/policy.json` |

### Integrity & Compliance

**ISO 27001-aligned audit logging** with append-only protocol and **cryptographic hash chain**. Each entry references the previous one — tampering is detectable. The compliance dashboard verifies chain integrity; **export** (JSON with integrity header or CSV) supports internal audits and external reviews.

### Network Resilience

Special filesystem handling for **UNC paths and network drives**: writes use temporary files in the same directory with **`fsync`** and atomic **`rename`**, including SMB fallback. Team vaults on file servers remain consistent even with parallel access.

### Security by Design — Key Rotation (Format v2)

Master password rotation via **secure key wrapping**: a random Data-Encryption-Key (DEK) encrypts the payload; the DEK is protected in the header with the password-derived Key Encryption Key (KEK). On rotation, **only the header is re-protected** — the encrypted payload block is copied 1:1. **No plaintext of secrets in RAM** during migration.

### Exclusive Access

Stable **file locking mechanisms** (`{vault}.lock`) prevent race conditions when opening concurrently. Stale locks are cleaned up using process metadata; on conflict, OxidVault reports which user/host holds the vault (`LockedBy`).

### Additional Enterprise Features

- **Two-factor authentication (TOTP)** — MFA enrollment, atomic unlock, UI rate limiting
- **Multi-User Vaults (v3)** — up to 5 users CE, unlimited EE; per-user password + MFA
- **Ed25519 license validation** — offline, tamper-resistant, no license server required
- **SSH known-hosts verification** — TOFU + stored fingerprint; MITM warning on mismatch
- **reveal_secret rate limiting** — sliding window (5 requests / 60s) against bulk extraction
- **Security Dashboard** — offline vulnerability analysis (duplicates, entropy, expiry dates)
- **Compliance Dashboard** — policy, audit, and key-age status with rotation recommendation (> 90 days)
- **SSH Quick Connect** — integrated terminal for stored SSH access
- **Browser extension** — native messaging for controlled autofill ([Chrome Web Store](https://chromewebstore.google.com/detail/oxidvault/belagnpfebgljfamjihdoinbcehingjd) · [`browser-extension/README.md`](browser-extension/README.md))
- **System Tray** — app minimizes to system tray; vault stays unlocked; restore on click; tray menu (Open / Lock / Quit)
- **Auto-Lock timer** — configurable in UI (1 / 5 / 10 / 15 / 30 min / Never); admin GPO overrides; default 10 minutes
- **PDF Compliance Report** — export audit log as A4 PDF with OxidVault branding, compliance status, and last 50 events; ideal for GDPR audits
- **Password Import** — migrate logins from Bitwarden, 1Password, KeePass, Chrome, or RoboForm (see [Password Import](#password-import))

### Password Import

Bring existing credentials into OxidVault without manual re-entry. Import runs **entirely in the desktop UI** (TypeScript parsers) — secrets are written through the existing `add_entry` command; no new cloud services and no vault format changes.

**Supported formats:**

| Source | Export type |
|---|---|
| Bitwarden | JSON (unencrypted vault export) |
| 1Password | CSV |
| KeePass | CSV (KeePass 1.x export) |
| Chrome | CSV (Password Manager download) |
| RoboForm | CSV (Extras → Export → Save as CSV) |

**Entry points:**

1. **First-run welcome** — after creating a new empty vault, OxidVault offers to import passwords or start fresh (shown once per vault path).
2. **Settings → General → Import passwords** — available anytime while the vault is unlocked.

**Import behaviour:**

- **Duplicate detection** — existing `web_login` entries with the same title and URL are skipped; `secure_note` duplicates are detected by title.
- **Secure notes (RoboForm)** — RoboForm rows with an empty password and login but a non-empty note are imported as **secure notes** (`Name` → title, `Note` → content, `Folder` → tag).
- **Preview & confirm** — choose format, pick the export file, review a sample table, then confirm before entries are added.

Technical details: [`ARCHITECTURE.md`](ARCHITECTURE.md) — section *Password Import (v2.3.0)*.

---

## Compliance & Security

> Detailed architecture and MFA specification: section [Security & Architecture](#security--architecture) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Zero-Knowledge Architecture

OxidVault follows a **zero-knowledge model**:

- The **master password** is used exclusively to derive the master key (Argon2id) and is not persisted.
- **Secret payloads** are encrypted with AES-256-GCM and do not leave the Rust core as plaintext over the IPC bridge by default.
- **MFA TOTP secrets** are stored encrypted in the vault payload; validation runs offline in the backend.
- Sensitive buffers are removed from memory with **`zeroize`** on lock, auth errors, and close.
- Explicit release (reveal, clipboard) is intentionally restricted and auditable.

### Cryptography (Excerpt)

| Component | Method |
|---|---|
| Key derivation | Argon2id (OWASP recommendation) |
| Encryption | AES-256-GCM |
| Second factor | TOTP / RFC 6238 (SHA-1, 6 digits, 30 s window) |
| Random numbers | OS CSPRNG (`getrandom`) |
| Password policy | Minimum length, blocklist, zxcvbn entropy (UX + backend) |

### Audit & Evidence

| Function | Description |
|---|---|
| Audit log | `{vault}.audit.log` — events such as `VaultCreated`, `VaultUnlocked`, `VaultKeyRotated` |
| Hash chain | SHA-256 chaining across all entries |
| Export | JSON (with integrity metadata) or CSV for auditors |
| Compliance status | IPC `get_compliance_status` — GPO flag, chain validity, key age |

> **Note:** OxidVault supports compliance processes technically (logging, integrity verification, export). Mapping to your ISMS (e.g. ISO 27001) is the responsibility of each organization.

---

## Getting Started

### Prerequisites

| Component | Version |
|---|---|
| Node.js | 20+ |
| Rust | stable (≥ 1.85, see `rust-toolchain.toml`) |
| Windows | WebView2 Runtime |
| Linux (build) | `libwebkit2gtk-4.1-dev` and GTK dependencies ([Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)) |

### Development

```bash
git clone https://github.com/caRl0oo/oxidvault.git
cd oxidvault
npm install
npm run tauri:dev      # Start desktop app (Windows: scripts/tauri-dev.ps1)
```

### Release Build (Windows)

```bash
npm install
npm run icons          # optional: regenerate icons from logo.png
npm run tauri:build    # MSI/NSIS-Installer
```

Installer artifacts: `target/release/bundle/` (MSI, NSIS, portable EXE).

### First Vault

1. Start OxidVault and **create a new vault** (local or UNC path).
2. Choose a **master password** according to policy (minimum length is shown).
3. Optional: enable **two-factor authentication** in settings (authenticator app).
4. Optional: deploy admin policy at `C:\ProgramData\OxidVault\policy.json`.
5. In the **Security** tab, review compliance status and password audit; **rotate password** if needed.

### Quality Assurance (CI)

The workflow [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) runs:

- `cargo audit` — dependency scan
- `cargo fmt --check` / `cargo clippy`
- `cargo test` — crypto and integration tests

---

## Technology

```
┌──────────────────────────────────────────────┐
│  Frontend     React 19 · TypeScript · Tailwind │
│               Vite 6                           │
├──────────────────────────────────────────────┤
│  IPC          Tauri v2 Invoke API              │
├──────────────────────────────────────────────┤
│  Desktop      Tauri v2 (Rust)                  │
├──────────────────────────────────────────────┤
│  Kern         vault-core (Rust)              │
│               auth · mfa · argon2 · aes-gcm  │
│               zeroize · totp-rs              │
└──────────────────────────────────────────────┘
```

| Layer | Technology | Role |
|---|---|---|
| **Backend / Crypto** | Rust (`vault-core`) | Encryption, vault logic, audit, policy, locking |
| **Desktop shell** | Tauri v2 | Native runtime, IPC commands, OS integration |
| **Frontend** | React + TypeScript | Presentation layer without business logic |
| **Build** | Vite, Cargo | Optimized release binaries (`LTO`, `strip`) |

This architecture strictly separates **business logic (Rust)** from the **UI (React)** — secrets and key material remain in the memory-safe backend.

---

## Community & Enterprise Edition

| Feature | Community (CE) | Enterprise (EE) |
|---|---|---|
| All current features | ✅ | ✅ |
| Up to 5 users per vault | ✅ | ✅ |
| Unlimited users | ❌ | ✅ |
| LDAP / Active Directory | ❌ | ✅ |
| SSO (SAML / OIDC) | ❌ | ✅ |
| Priority support + SLA | ❌ | ✅ |
| License | AGPLv3 (Open Source) | Commercial |
| Price | Free | On request |

→ **[oxidvault.com](https://oxidvault.com)** · [support@oxidvault.com](mailto:support@oxidvault.com)

## Download

→ **[Latest version on GitHub Releases](https://github.com/caRl0oo/oxidvault/releases/latest)**

| Platform | File |
|---|---|
| **Windows** | `OxidVault_2.3.0_x64_en-US.msi` |

> **Note:** After installation, place the license file for Enterprise at `C:\ProgramData\OxidVault\oxidvault.license` — details: [oxidvault.com](https://oxidvault.com)

---

## Changelog

### [2.3.0] — Password Import

- **Password Import** — client-side parsers for Bitwarden JSON, 1Password CSV, KeePass CSV, Chrome CSV, and RoboForm CSV
- **First-run welcome modal** — offered after new empty vault creation; dismissible per vault via `importOfferedPaths` in app settings
- **Settings entry** — Import passwords under General settings (vault unlocked)
- **Duplicate detection** — skip existing entries (title + URL for logins; title for secure notes)
- **RoboForm secure notes** — note-only RoboForm rows import as `secure_note` entries

### [2.2.0] — Auto-Lock & PDF Compliance

- **Auto-Lock timer UI** — configurable in Settings → Security (1/5/10/15/30 min/Never); default 10 minutes; GPO-compatible
- **PDF Compliance Report** — export from Activity log tab; A4, OxidVault branding, compliance status, last 50 audit events; full export still available as JSON/CSV

### [2.1.1] — System Tray Bugfixes

- **Extension focus loop fixed** — app no longer pops up when minimized to tray
- **Deadlock protection** — `perform_lock` with 5s timeout
- **Tray hide correctly detected** — `is_visible()` check instead of only `is_minimized()`

### [2.1.0] — System Tray

- **System Tray** — X button and minimize hide app in tray; vault stays unlocked
- **Ctrl+Q** — clean quit with RAM purge before exit
- **Tray menu** — Open / Lock vault / Quit
- **GPO `forceLockOnMinimize`** — locks vault when hiding to tray if admin policy is active

### [2.0.1] — Bugfixes

- **Extension banner removed** — in-page banner appeared on every page load; status now only visible in extension popup
- **Focus loop fix** — browser extension no longer focuses app when vault is minimized
- **Mobile menu fix** — landing page oxidvault.com

### [2.0.0] — Multi-User & Security

#### Multi-User Architecture

- **Format v3** — shared DEK, per-user KEK wrapping, user table in plaintext header
- **Multi-User login** — username text field (no dropdown, no username enumeration risk)
- **User management** — admin can add/remove users, change roles
- **Change password** — each user can rotate their own password without vault re-encrypt
- **MFA per user** — TOTP in user entry (KEK-encrypted), not in vault payload
- **Migration v1/v2 → v3** — one-time operation in settings

#### Security

- **SSH known-hosts** — TOFU + stored SHA-256 fingerprint; MITM warning on mismatch
- **reveal_secret rate limiting** — sliding window (5/60s), reset on lock, audit event
- **reload_from_disk v3** — DEK preserved after Git sync pull; no silent session loss
- **Ed25519 license signing** — asymmetric; public key embedded in binary; private key never in repo; open source safe
- **UI overhaul** — Raycast-inspired Oxid Light theme as default; vault-card, vault-input, vault-btn-* design tokens

### [1.0.0] — Enterprise Release

#### Security & Authentication

- **TOTP MFA (RFC 6238)** — enrollment with QR code, encrypted secret storage in vault payload, settings UI (`MfaSetupModal`, `get_mfa_status`, `disable_mfa`).
- **Atomic unlock** — new module `vault-core/src/auth.rs` with `unlock_vault(password, mfa_code) → VaultHandle | AuthError`; no partially decrypted vault state in RAM; removal of `PendingUnlock` / two-stage pending unlock.
- **IPC** — `open_vault` / `unlock_vault` accept optional `mfa_code`; unified `UnlockVaultResponse` flow.
- **Unlock UX** — dynamic MFA field in `AuthForm`, auto-focus, auto-submit at 6 digits.
- **UI rate limiting** — `useMfaRateLimit`: after 3 invalid MFA codes, 30 s lockout with countdown (`vault-danger` theme tokens).

#### Documentation

- `ARCHITECTURE.md` — atomic unlock data flow, `AuthError`, `UnlockVaultResponse`, changelog entries.

---

## Documentation & License

| Resource | Content |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Complete technical reference (IPC, file formats, security) |
| [`browser-extension/README.md`](browser-extension/README.md) | Browser integration via native messaging |
| [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md) | Commercial license without AGPLv3 obligations |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributions, CLA, security reporting |

### Licensing

OxidVault is licensed under the **[GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html)**. AGPL-3.0 requires anyone who distributes the software (or derivative works) or provides it as a network service to make the **complete source code** available under the same license. For enterprise environments, this means: changes to the vault core, cryptography, or security-relevant components remain traceable and cannot be passed on as a proprietary black box without source disclosure — a central building block for **transparency, auditability, and long-term security**.

A **commercial Enterprise license** is available for commercial use without AGPLv3 obligations.  
Details: [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) · [support@oxidvault.com](mailto:support@oxidvault.com)

---

## Security & Responsible Disclosure

If you discover a security vulnerability in OxidVault, please report it **confidentially** — not via public issues or pull requests.

| Channel | Address |
|---|---|
| **Security Contact** | [security@oxidvault.com](mailto:security@oxidvault.com) |

Please describe the affected version, platform, reproduction steps, and — if possible — a proof of concept. We typically acknowledge receipt within **72 hours** and coordinate a responsible disclosure timeline with you before details are published.

> **Note:** Reports to `security@oxidvault.com` are intended for security incidents only. For general support or feature requests, please use the project issues on GitHub.

---

## Enterprise & Compliance

OxidVault supports **enterprise policies** via a machine-wide `policy.json` (auto-lock, minimum password length, Git sync, lock-on-minimize). IT teams can roll out requirements centrally via GPO or Intune without end users being able to override these settings.

| Resource | Content |
|---|---|
| [Admin Deployment Guide](ARCHITECTURE.md#16-admin-deployment-guide) | GPO rollout in ~5 minutes, paths, fail-safe logic, verification |
| [`docs/policy.json.example`](docs/policy.json.example) | Template with all supported policy fields |

---

*OxidVault — Built for admins who don't have time for slow tools.*
