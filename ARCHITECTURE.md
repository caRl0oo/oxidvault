# OxidVault — Technical Architecture

> **Single Source of Truth**  
> This document is the central reference for the technical architecture of OxidVault.  
> Whenever core features, Tauri Commands, file formats, or security-relevant changes are added, **ARCHITECTURE.md** must be updated in sync with the code.

**Version:** 2.4.0

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Security & Crypto Specifications](#3-security--crypto-specifications)
4. [Directory Structure](#4-directory-structure)
5. [System Architecture](#5-system-architecture)
6. [API Interfaces (Tauri Commands)](#6-api-interfaces-tauri-commands)
7. [File Formats](#7-file-formats)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Build, Deployment & Operations](#9-build-deployment--operations)
10. [Browser Extension — Native Messaging (Phase 1–3)](#10-browser-extension--native-messaging-phase-13)
11. [Audit Logging & Compliance (ISO 27001)](#11-audit-logging--compliance-iso-27001)
12. [Vault Persistence: UNC Paths & Atomic Writes](#12-vault-persistence-unc-paths--atomic-writes)
13. [Centralized Policy Management & Admin GPOs](#13-centralized-policy-management--admin-gpos)
14. [Documentation Requirements](#14-documentation-requirements)
15. [Key Rotation & Compliance Dashboard](#15-key-rotation--compliance-dashboard)
16. [Admin Deployment Guide](docs/ADMIN_DEPLOYMENT.md)
17. [Licensing Model](#17-licensing-model)

---

## 1. Project Overview

### Name

**OxidVault** — an ultra-fast, minimally designed B2B password and secret manager.

### Target Audience

| Persona | Requirements |
|---|---|
| **IT Administrators** | Central credential management, fast rotation, clear audit trails |
| **DevOps Engineers** | CLI/API-friendly workflows, self-hosted operation, pipeline integration |
| **Power Users** | Keyboard-first operation, minimal UI latency, full offline control |

### Core Philosophy

| Principle | Description |
|---|---|
| **Offline-First** | No cloud dependency. The vault runs entirely locally or self-hosted. Network access is optional, never required. |
| **Ultra-Fast** | Memory-safe Rust core, lean UI, optimized release profiles (`LTO`, `opt-level = "z"`). Latency-critical paths remain in the backend. |
| **Keyboard-Optimized** | All core actions reachable via shortcuts. Mouse operation is supplementary, not required. |
| **Zero-Knowledge** | The master key and all secret payloads remain in the Rust core. Plaintext secrets **must not** cross the Tauri IPC bridge into the JavaScript heap (V8) by default — only metadata, explicit `reveal_secret`, or OS clipboard via `copy_to_clipboard`. |
| **Minimalism** | No feature bloat. Every component has a clearly defined responsibility. |

---

## 2. Tech-Stack

### Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Presentation Layer)                          │
│  React 19 · TypeScript 5 · Tailwind CSS 4 · Vite 6    │
├─────────────────────────────────────────────────────────┤
│  IPC-Bridge                                             │
│  Tauri v2 Invoke API (@tauri-apps/api)                  │
├─────────────────────────────────────────────────────────┤
│  Desktop-Shell (Application Layer)                      │
│  Tauri v2 · Rust · tauri-plugin-shell                   │
├─────────────────────────────────────────────────────────┤
│  Vault-Kern (Domain / Crypto Layer)                     │
│  vault-core · argon2 · aes-gcm · zeroize · arboard · serde │
└─────────────────────────────────────────────────────────┘
```

### Frontend

| Technology | Version | Role |
|---|---|---|
| **React** | 19.x | UI components, state management |
| **TypeScript** | 5.8.x | Type safety, IPC contracts |
| **i18next / react-i18next** | 25.x / 15.x | Frontend localization (DE/EN) |
| **Tailwind CSS** | 4.x | Utility-first styling, dark theme |
| **Vite** | 6.x | Dev server (port `1420`), production bundling |

### Desktop Shell & Backend

| Technology | Version | Role |
|---|---|---|
| **Tauri** | 2.x | Native desktop runtime, WebView, IPC |
| **Rust** | stable (≥ 1.85) | Memory-safe backend logic |
| **tauri-plugin-shell** | 2.x | Controlled system shell access |

### Rust Workspace

| Crate | Path | Responsibility |
|---|---|---|
| `vault-core` | `crates/vault-core/` | Cryptography, vault logic, file format |
| `oxidvault` | `src-tauri/` | Tauri integration, commands, app state |

### Tools

| Tool | Purpose |
|---|---|
| `rust-toolchain.toml` | Pinning to stable Rust + `rustfmt` / `clippy` |
| `@tauri-apps/cli` | Dev build, bundling, icon generation |
| `scripts/generate-icons.mjs` | Legacy fallback icons (replaced by `npm run icons`) |

---

## 3. Security & Crypto Specifications

### Zero-Knowledge Architecture

OxidVault follows a **zero-knowledge model**: the server or desktop runtime never knows the master password or the derived master key in unencrypted form outside the protected memory region in the Rust core.

```
Master password
      │
      ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Argon2id   │────▶│   Master Key     │────▶│  AES-256-GCM    │
│  (KDF)      │     │  (32 bytes, RAM) │     │  vault payload  │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                       │                        │
      │ Salt (per vault)      │ ZeroizeOnDrop on lock   │ Nonce (per blob, OsRng)
      ▼                       ▼                        ▼
  .oxid header            Never to frontend         Encrypted file
```

**Guarantees:**

- The master password is **not** persisted, logged, or passed to the frontend.
- Incoming master passwords in Tauri Commands are immediately wrapped in **`zeroize::Zeroizing<String>`** and overwritten after KDF use.
- The master key is removed from memory on `lock_vault` via `zeroize` (`MasterKey`: `Zeroize` + `ZeroizeOnDrop`).
- The frontend communicates exclusively through typed Tauri Commands — no direct file or crypto access.
- CSP in `tauri.conf.json` restricts script and style sources to `'self'`.

#### IPC Bridge & V8 Heap Protection (Enterprise Hardening — K4)

> **Status:** ✅ `SecretEntryPublic` · `reveal_secret` · `copy_to_clipboard` · `src-tauri/src/clipboard.rs`

The **JavaScript heap (V8)** in the WebView cannot be deterministically zeroized. OxidVault therefore treats React frontend memory as **untrusted** for secret plaintext:

| Rule | Implementation |
|---|---|
| **No default IPC for secrets** | `get_entry` returns only **`SecretEntryPublic`** — metadata (title, URL, username, host, …) without password, token, private key, or note content |
| **Reveal on Demand** | `reveal_secret(entry_id, field?)` — short-lived plaintext + `warning` string; frontend must discard value after display |
| **Clipboard only via Rust** | `copy_to_clipboard(entry_id, field?)` — secret decrypted in Rust core, written to OS clipboard via **`arboard`**, **30 s auto-clear** by Rust background thread |
| **Edit mode** | `NewSecretModal` loads secrets on open via `reveal_secret` — temporarily in form state, not in detail IPC |

```
Detail view / sidebar
        │
        ├── list_entries / get_entry ──► SecretEntrySummary / SecretEntryPublic
        │                                 (no password, token, private_key, content)
        │
        ├── Reveal (eye) ──► reveal_secret ──► short-lived in React state
        │
        └── Copy ──► copy_to_clipboard ──► arboard (OS) ──► 30s Rust timer ──► clear
```

**Why plaintext must not go to the frontend by default:**

- Every IPC serialization creates `String` copies in the Rust **and** JS heap without `ZeroizeOnDrop`.
- Garbage collection in V8 does not guarantee memory pages are freed — plaintext fragments can remain for a long time.
- DevTools, browser extensions, and crash dumps in the WebView context increase the attack surface.

**Limitation (documented honestly):** `reveal_secret` and the edit form flow inevitably create short-lived plaintext copies over IPC or in React state. The threat model minimizes duration and frequency — clipboard and bulk export run exclusively through Rust. Third-party clipboard managers that read `CF_TEXT` directly are not blocked by OS exclusion hints.

### Key Derivation (KDF): Argon2id

| Parameter | Value | Rationale |
|---|---|---|
| **Algorithm** | Argon2id | Hybrid defense against side-channel and GPU attacks |
| **Output length** | 32 bytes (256 bit) | Compatible with AES-256 |
| **Salt** | 16 bytes, cryptographically random | Unique per vault, stored in header |
| **Memory (m)** | 64 MiB | B2B-grade brute-force protection |
| **Iterations (t)** | 3 | OWASP recommendation for Argon2id |
| **Parallelism (p)** | 4 | Balanced for desktop hardware |

**Implementation status:** ✅ Implemented in `crates/vault-core/src/crypto.rs` (`MasterKey::derive_from_password`).

**Memory hardening (K2):** The stack buffer for KDF output is held as **`Zeroizing<[u8; 32]>`** — on success **and** failure (early return via `?`) the buffer is overwritten on drop before being passed to `MasterKey`.

### Master Password Policy

> Applies **only when creating** a new vault (`create_vault`). When opening existing vaults, the original password length is respected.

| Rule | Value | Enforcement |
|---|---|---|
| **Minimum length** | 12 characters | Frontend (submit button) + backend (`policy.rs`) |
| **Blocklist** | ~45 common passwords (`password`, `admin123`, `12345678`, …) | Frontend + backend (exact match, case-insensitive) |
| **Entropy check** | zxcvbn score ≥ 2 (0–4 scale) | Frontend (UX) + backend (authoritative, `zxcvbn` crate) |

**UX feedback (frontend):**

- Password field: red = policy violated, green = satisfied
- Progress bar + label (Very weak → Very strong)
- Checklist: length · blocklist · entropy
- Submit disabled until all criteria are met

**Backend module:** `crates/vault-core/src/policy/password.rs` · Error: `VaultError::WeakPassword(WeakPasswordReason)` (`too_short` | `blocklisted` | `low_entropy`)

**Note:** zxcvbn runs client-side for real-time UX feedback; the backend enforces the same score ≥ 2 threshold authoritatively on password set.

**Exception:** `migrate_to_v3` re-wraps the existing v1/v2 master password as the first admin user — password policy is not re-evaluated (set vs. re-wrap).

### Symmetric Encryption: AES-256-GCM

| Parameter | Value |
|---|---|
| **Algorithm** | AES-256-GCM (AEAD) |
| **Key** | Derived 256-bit master key |
| **Nonce / IV** | 12 bytes, unique per encrypted blob (never reuse) |
| **Nonce source** | `aes_gcm::aead::OsRng` — OS CSPRNG, fresh per `encrypt()` call |
| **Auth tag** | 128 bit (standard GCM) |
| **AAD** | v4 multi-user: full plaintext header (magic → end of `users_json`) as AES-GCM AAD; v1–v3: empty AAD (legacy) |

**Use cases:**

- Vault file body (secret entries, notes, attachments)
- Export bundles (optionally password-protected with separate ephemeral key)

**Implementation status:** ✅ Implemented in `crates/vault-core/src/crypto.rs` (`encrypt` / `decrypt` / `encrypt_with_aad` / `decrypt_with_aad`).

| Function | Return / behavior |
|---|---|
| `encrypt(key, plaintext)` | Fresh 12-byte nonce + ciphertext (empty AAD — legacy v1–v3) |
| `encrypt_with_aad(key, plaintext, aad)` | Same, with associated authenticated data |
| `decrypt(key, nonce, ciphertext)` | **`Zeroizing<Vec<u8>>`** — plaintext heap overwritten on drop (K1) |
| `decrypt_with_aad(key, nonce, ciphertext, aad)` | Same with AAD verification |
| Wrong password / tampered ciphertext or AAD | GCM auth error → `VaultError::InvalidPassword` (no distinction — intentional, no decryption oracle) |

**Consumer:** `format.rs` deserializes from `plaintext.as_ref()` and releases `Zeroizing<Vec<u8>>` at scope end.

### Memory Safety

| Measure | Crate / mechanism |
|---|---|
| Key deletion on lock | `zeroize` + `ZeroizeOnDrop` on `MasterKey` |
| Secret purge on lock | `SecretPayload::zeroize_secrets()` before `entries.clear()` |
| **Plaintext heap after decrypt (K1)** | `decrypt()` → `Zeroizing<Vec<u8>>` in `crypto.rs` |
| **KDF stack buffer (K2)** | `Zeroizing<[u8; 32]>` in `derive_from_password` — all exit paths |
| **Zero-clone persist (K3)** | `persist()` serializes `&self.entries` in-place — no `entries.clone()` |
| **Serialization buffer (K3)** | `serialize_entries_zeroizing()` in `format.rs` → `Zeroizing<Vec<u8>>` before `encrypt` |
| **IPC without secrets (K4)** | `get_entry` → `SecretEntryPublic`; secrets only via `reveal_secret` / `copy_to_clipboard` |
| **Known-host fingerprint** | Part of `SecretPayload` → AES-256-GCM in `.oxid` body; never as plaintext over IPC (`has_known_host_fingerprint: bool` only) |
| **Incoming passwords (K4)** | `Zeroizing<String>` in `create_vault`, `open_vault`, `unlock_vault` |
| **session_kek (v3)** | `Zeroizing<[u8; 32]>` on `Vault` — KEK of current user; RAM only during session; set to `None` on `lock()` (ZeroizeOnDrop) |
| **Atomic writes** | Temp file `.oxid.tmp` → `fsync` → `rename` (crash-safe) |
| **Lock-on-minimize (GPO)** | `forceLockOnMinimize` in `window_events.rs` when hiding to tray |
| No plaintext in logs | No `Debug` output for sensitive structs (`MasterKey` without `Debug`) |
| Release hardening | `panic = "abort"`, `strip = true`, `LTO` |

#### Zeroizing in the Crypto Core (K1 & K2)

> **Status:** ✅ `crates/vault-core/src/crypto.rs`

| Location | Type | When zeroized |
|---|---|---|
| KDF output (stack) | `Zeroizing<[u8; 32]>` | Drop after `hash_password_into` (Ok **and** Err) |
| Master key (heap) | `MasterKey` with `ZeroizeOnDrop` | `lock_vault` → `master_key = None` |
| Decrypt plaintext (heap) | `Zeroizing<Vec<u8>>` | After deserialization in `read_vault_file` |
| Persist JSON (heap) | `Zeroizing<Vec<u8>>` | After `encrypt()` in `write_vault_bytes` |
| Extract/reveal (Rust) | `Zeroizing<String>` | Drop after clipboard write or IPC serialization |

```
decrypt(ciphertext)
      │
      ▼
Zeroizing<Vec<u8>>  ──► serde_json::from_slice ──► VaultPayload
      │                                              (Strings im Vault-RAM)
      ▼
Drop → heap overwritten (K1)

derive_from_password(password)
      │
      ▼
Zeroizing<[u8; 32]> on stack ──► Ok(MasterKey) / Err(?)
      │
      ▼
Drop → stack overwritten (K2)
```

#### Zero-Clone Policy on Persist (K3)

> **Status:** ✅ `crates/vault-core/src/vault.rs` · `format.rs`

Previously, `persist()` copied all entries via `entries.clone()` — a deep copy of all `String` passwords in RAM on every save. This contradicts the zero-knowledge promise (additional plaintext fragments outside the authoritative `entries` list).

**Current behavior:**

```rust
// vault.rs — persist()
format::update_vault_file(path, &self.name, self.kdf, &salt, key, &self.entries)
//                                                                      ^^^^^^^^^^^^^
//                                                              borrow, no clone
```

```rust
// format.rs
serialize_entries_zeroizing(entries: &[SecretEntry]) → Zeroizing<Vec<u8>>
crypto::encrypt(key, plaintext.as_ref())
// plaintext (Zeroizing) is dropped and overwritten after encrypt()
```

| Aspect | Detail |
|---|---|
| **Serialization** | `VaultPayloadRef { entries: &'a [SecretEntry] }` — serde serializes by reference |
| **No deep clone** | No `.clone()` on `entries`, passwords, or payloads in `persist()` |
| **Plaintext lifetime** | JSON buffer exists only for the duration of `write_vault_bytes` |
| **Atomic write** | `.oxid.tmp` → `fsync` → `rename` with SMB fallback (details: [§12](#12-vault-persistence-unc-paths--atomic-writes)) |

#### Atomic Writes (Enterprise Hardening)

> **Status:** ✅ `crates/vault-core/src/format.rs` · `atomic_write_vault()`  
> **Details:** [§12 Vault Persistence](#12-vault-persistence-unc-paths--atomic-writes)

Prevents corrupted `.oxid` files on crash, power loss, or SMB locking during save:

```
encrypt(payload) → write {dir}/{name}.oxid.tmp → sync_all()
                         │
                         ▼
              fs::rename(.tmp → .oxid)   ← atomar (gleiches Volume/Share)
                         │
              Rename fehlgeschlagen? (z. B. SMB-Lock)
                         │
                         ▼
              copy(.tmp → .oxid) → sync_all(.oxid) → remove(.tmp)
                         │
              Bei Fehler: .tmp wird gelöscht, Original bleibt intakt (Rename-Pfad)
```

| Aspect | Detail |
|---|---|
| **Temp file** | `{dir}/{name}.oxid.tmp` — **required** in the same directory as the target file (UNC/SMB) |
| **Sync (temp)** | `File::sync_all()` after write — data on disk/share |
| **Rename** | `std::fs::rename` — atomic replace on local FS and same share |
| **SMB fallback** | `OpenOptions` (truncate) → `std::io::copy` → `sync_all` on target file → delete temp |
| **UNC paths** | `path_util::normalize_vault_path` in `vault.rs` (Create/Open/Attach) |
| **Usage** | `write_vault_file` (Create) and `update_vault_file` (Update) |

#### Minimize to Tray & Optional Lock-on-Minimize (GPO)

> **Status:** ✅ `src-tauri/src/system_tray.rs` · `window_events.rs` · Event `vault-locked`

Closing (X) or minimizing hides the window in the system tray — the vault remains unlocked by default:

```
Close window / minimize
      │
      ▼
CloseRequested → prevent_close + hide()
Focused(false) + is_minimized() → hide()
      │
      ├─ forceLockOnMinimize (GPO) → perform_lock() + vault-locked
      │
      ▼
Tray-Icon bleibt sichtbar — Vault entsperrt (Default)
```

| Aspect | Detail |
|---|---|
| **Tray menu** | Status, Open, Lock, Quit — localized (de/en) |
| **Quit** | Only via tray → "Quit" (with lock before exit) |
| **GPO** | `forceLockOnMinimize: true` → additional lock when hiding |
| **Restore** | Tray click or menu "Open OxidVault" |

#### RAM Purge on Auto-Lock / Manual Lock (v0.1.0)

> **Status:** ✅ Backend `idle_worker.rs` · `AppState::touch_activity` · Frontend `useAutoLock` (warning + UI pings)

On every lock (`lock_vault`, auto-lock, lock-on-minimize, `Ctrl+L`), decrypted data is aggressively removed from working memory:

```
Idle-Timeout (Backend) oder Ctrl+L / Minimize
         │
         ▼
Backend: perform_lock()  [SSH disconnect + Vault::lock() + RAM-Purge]
         │
         ├─ reason "idle" / "minimize" → Tauri Event `vault-locked`
         │
         ▼
Frontend: Listener `vault-locked` → UI-Reset + Hinweis
```

| Component | Purge mechanism |
|---|---|
| **Master key** | `#[derive(Zeroize, ZeroizeOnDrop)]` on `MasterKey([u8; 32])` |
| **Secret strings** | `String::zeroize()` on password, token, keys before drop |
| **Frontend state** | Entries, detail view, form state reset |
| **Clipboard (backend)** | `SecureClipboard::cancel_pending()` on `perform_lock()` |

**Auto-lock parameters (backend-authoritative):**

| Parameter | Value / source |
|---|---|
| **Inactivity timeout** | `autoLockSeconds` from `settings.json` + admin override `policy.json` |
| **Idle watcher** | `src-tauri/src/idle_worker.rs` — `tokio` 1s tick, re-reads policy **every tick** |
| **Activity tracking** | `AppState::last_activity` — vault commands + NM bridge + IPC `touch_activity` |
| **UI activity** | `useAutoLock.ts` → `touch_activity` on DOM events (no frontend timer) |
| **Pre-warning** | Event `vault-idle-warning` { `secondsRemaining`: 30 } — 30 s before lock |
| **Lock event** | `vault-locked` { `reason`: `"idle"`, `autoLockSeconds`: effective timeout } |
| **Reachability polling** | **No** activity touch (would prevent idle lock) |

### Password Generator (v0.1.0)

> **Status:** ✅ `crates/vault-generator` (shared) · `vault-core` re-export · Tauri `generate_password_cmd` · WASM `vault-wasm`

| Parameter | Value |
|---|---|
| **Default length** | 24 characters |
| **Length range** | 8–128 characters |
| **Character sets** | Uppercase, lowercase, digits, special characters (configurable) |
| **RNG** | `rand::rngs::OsRng` (CSPRNG — cryptographically secure) |
| **Guarantee** | At least one character per active character set |
| **Shuffle** | Fisher-Yates after construction |

**Frontend:** `PasswordGeneratorModal` · Shortcut `Ctrl+G` · key icon (`PasswordGenerateButton`) next to secret password fields

**Form coupling:** When opened from a secret form, an `onApply` callback is registered. "Apply" (inline + footer) and "Copy" insert the generated password directly into the active form field — no manual paste required.

**Note:** The generator does not require an unlocked vault — pure utility function in the Rust core.

### Clipboard Auto-Clear (v1.0.0 — Security Hardening K4)

> **Status:** ✅ Rust: `src-tauri/src/clipboard.rs` (`arboard`) · Frontend toast: `src/lib/secureClipboard.ts`

OxidVault treats the system clipboard as an **ephemeral channel**. Secrets are **no longer** copied from the frontend via `navigator.clipboard` — the Rust core writes directly to the OS.

| Parameter | Value |
|---|---|
| **Auto-clear delay** | 30 seconds (exact) |
| **Write** | Rust crate **`arboard`** (native OS clipboard) |
| **Windows history / cloud exclusion** | `SetExtWindows`: `exclude_from_history()` + `exclude_from_cloud()` on secret copy and clear (Win+V / cloud clipboard) |
| **Timer** | `std::thread::spawn` + `sleep(30s)` — independent of JS event loop |
| **Clear strategy** | `get_text()` === stored secret → empty string with same Windows exclusion flags |
| **Generation counter** | New copy invalidates older clear timers |
| **Cancel on lock** | `SecureClipboard::cancel_pending()` in `perform_lock()` |

**UX feedback (frontend):**

- After `copy_to_clipboard`: `notifyBackendSecureCopy()` starts countdown UI (toast + button label)
- Button label: `Copied! (29s)` … countdown until clear
- Toast (`ClipboardToast`): "Copied to clipboard — will be cleared automatically in Xs"
- **Usernames / URLs** (not secret): still frontend `navigator.clipboard` via `useSecureCopy().copy()`

**Flow (secret copy):**

```
Frontend: copy_to_clipboard(entry_id, field?)
        │
        ▼
Rust: Vault::extract_secret → Zeroizing<String>
        │
        ▼
arboard::Clipboard::set() [+ SetExtWindows on Windows]
        │
        ▼
Background thread: sleep(30s) → clear if unchanged
        │
        ▼
Frontend: notifyBackendSecureCopy() → Toast-Countdown
        │
        ▼
Bei lock_vault: cancel_pending() — Timer wird invalidiert
```

**Legacy note:** `copySecureToClipboard()` in `secureClipboard.ts` remains for **non-sensitive** fields (username). Passwords, tokens, and keys use exclusively `copy_to_clipboard`.

---

## 4. Directory Structure

```
OxidVault/
├── ARCHITECTURE.md          ← This file (Single Source of Truth)
├── CHANGELOG.md             ← Release history
├── DEVELOPMENT_LOG.md       ← Architecture backlog & refactoring ideas
├── Cargo.toml               ← Rust workspace root
├── rust-toolchain.toml      ← Rust toolchain pinning
├── package.json             ← Frontend dependencies & npm scripts
├── vite.config.ts           ← Vite + Tailwind + Tauri dev server
├── tsconfig*.json           ← TypeScript configuration
├── index.html               ← Frontend entry point
│
├── crates/
│   └── vault-core/          ← ★ Rust core (crypto, vault domain)
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs       ← Re-exports
│           ├── crypto.rs    ← Argon2id KDF, AES-256-GCM
│           ├── format.rs    ← .oxid read/write
│           ├── license.rs   ← CE/EE license (Ed25519, offline)
│           ├── lock.rs      ← Exclusive vault file lock
│           ├── policy/      ← Master password rules + admin GPO (`policy.json`)
│           ├── entry.rs     ← SecretEntry, SecretEntryPublic, SecretField
│           ├── vault.rs     ← Vault lifecycle, persistence
│           ├── vault_user.rs← Multi-user KEK wrapping
│           ├── auth.rs      ← Atomic unlock orchestration
│           ├── mfa.rs       ← TOTP enrollment & verification
│           ├── compliance.rs← GPO / audit / key-age status
│           ├── diagnostics.rs← Admin support snapshot
│           ├── generator.rs ← CSPRNG password generator
│           ├── audit.rs          ← ISO-27001 compliance log (append-only, hash chain)
│           ├── audit_export.rs   ← JSON/CSV audit export
│           ├── audit_secure.rs   ← OS permissions for audit log
│           ├── security_audit.rs ← Offline security audit (duplicates, weakness, score)
│           ├── os_protect.rs     ← Owner-only file ACLs (session, audit)
│           ├── url_match.rs      ← eTLD+1 hostname matching (extension autofill)
│           ├── path_util.rs      ← UNC path normalization
│           ├── unlock.rs         ← Unlock step types
│           ├── expiry.rs         ← Password expiry (YYYY-MM-DD, 14-day warning)
│           ├── probe.rs          ← Host/port resolution for live ping
│           └── error.rs          ← VaultError
│
├── src/                     ← ★ Frontend (React + TypeScript)
│   ├── main.tsx             ← React bootstrap
│   ├── App.tsx              ← Root component, vault UI
│   ├── components/          ← Reusable UI building blocks
│   │   └── Layout.tsx
│   ├── hooks/               ← Custom React Hooks
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useAutoLock.ts
│   │   └── useSecureCopy.ts  ← copySecret → copy_to_clipboard IPC
│   ├── lib/                 ← IPC, dialogs, theme, search, clipboard
│   │   ├── ipc.ts
│   │   └── dialog.ts
│   ├── types/               ← Shared TypeScript types
│   │   └── vault.ts
│   └── styles/
│       └── globals.css      ← Tailwind + design tokens
│
├── src-tauri/               ← ★ Tauri backend (desktop shell)
│   ├── Cargo.toml
│   ├── tauri.conf.json      ← Tauri app configuration (version source of truth)
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json     ← Tauri v2 Permission-Capabilities
│   ├── icons/               ← App icons (via `npm run icons` from `logo.png`)
│   └── src/
│       ├── main.rs          ← Binary entry (--native-messaging → headless)
│       ├── lib.rs           ← Tauri builder, plugin init, state
│       ├── native_messaging.rs ← Chrome/Firefox Native Messaging Host (stdio)
│       ├── clipboard.rs     ← SecureClipboard (arboard, 30s Auto-Clear)
│       ├── probe/           ← Async TCP-Reachability-Checks
│       │   └── mod.rs
│       ├── system_tray.rs     ← System tray (minimize to tray, menu)
│       ├── window_events.rs   ← Close/minimize → tray (+ optional GPO lock)
│       ├── settings.rs        ← App settings (vault path, Git sync, no secrets)
│       ├── git/                 ← In-process Git sync via `git2` (no external `git` binary)
│       │   ├── mod.rs
│       │   ├── git_sync.rs      ← `sync_vault`, pull/commit/push
│       │   ├── remote_auth.rs   ← `RemoteCallbacks`, SSH agent → key file + keyring, HTTPS basic auth
│       │   ├── ssh_keyring.rs   ← OS keyring (`oxidvault-git` / `git-ssh-passphrase`)
│       │   └── errors.rs        ← `GitSyncError` (code + message)
│       ├── ssh/             ← SSH Quick Connect (russh; provider abstraction)
│       │   ├── mod.rs       ← SshManager, session loop, Tauri events
│       │   ├── auth.rs      ← Public-key auth (ring)
│       │   ├── key_loader.rs← PEM/PPK from vault RAM
│       │   └── provider/
│       │       ├── mod.rs       ← Trait `SshConnection`, `ConnectContext`
│       │       └── russh_provider.rs ← `RusshProvider` (russh backend)
│       └── commands/
│           ├── mod.rs       ← Tauri command handlers
│           ├── bootstrap.rs ← Smart start, detach vault
│           ├── lock.rs      ← perform_lock (RAM purge)
│           ├── open_url.rs  ← Safe http(s) URL open
│           └── ssh.rs       ← ssh_connect / ssh_write / ssh_disconnect
│
├── browser-extension/       ← ★ Browser extension (Phase 2: MV3 + background)
│   ├── manifest.json        ← Manifest V3 (nativeMessaging)
│   ├── background.js        ← connectNative, ping on start
│   ├── README.md            ← 3-step E2E guide (ping/pong)
│   └── host/
│       └── com.oxidvault.app.json  ← Native host manifest (via PS script)
│
├── scripts/
│   ├── register_native_host.ps1   ← Registry + host manifest (Chrome/Edge)
│   ├── tauri-dev.ps1
│   ├── tauri-build.ps1
│   ├── generate-icons.mjs
│   └── sync-version.mjs ← Sync app version from tauri.conf.json → ARCHITECTURE.md + README.md
│
├── docs/
│   ├── policy.json.example
│   └── ADMIN_DEPLOYMENT.md
│
├── public/                  ← Static assets (SVG, etc.)
└── dist/                    ← Vite production build (generated)
```

### Separation of Concerns

| Layer | Path | May know / do |
|---|---|---|
| **Frontend** | `src/` | Render UI, shortcuts, IPC calls — **no plaintext secret state by default** |
| **IPC** | `src/lib/ipc.ts` ↔ `src-tauri/src/commands/` | Typed request/response boundary; secrets only via `reveal_secret` / `copy_to_clipboard` |
| **Shell** | `src-tauri/` | Window management, plugins, app state |
| **Core** | `crates/vault-core/` | Crypto, persistence, business logic |

---

## 5. System Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend (src/)"]
        UI[React UI]
        IPC_TS[ipc.ts]
        UI --> IPC_TS
    end

    subgraph TauriShell["Tauri Shell (src-tauri/)"]
        CMD[commands/mod.rs]
        STATE[AppState]
        CMD --> STATE
    end

    subgraph Core["Vault Core (crates/vault-core/)"]
        VAULT[Vault]
        CRYPTO[Crypto Engine]
        VAULT --> CRYPTO
    end

    IPC_TS -- "invoke()" --> CMD
    STATE --> VAULT
    VAULT -- ".oxid file" --> DISK[(Local filesystem)]
```

### System Tray

> **Status:** ✅ `src-tauri/src/system_tray.rs` · Icon `icons/32x32.png`

| Action | Behavior |
|---|---|
| Close window (X) | Minimize app to tray — vault stays unlocked |
| Minimize window | Hide from taskbar to tray — vault stays unlocked |
| Tray left-click / double-click | Restore app |
| Tray → "Lock vault" | RAM purge + lock |
| Tray → "Quit" | Lock + `app.exit(0)` |
| `forceLockOnMinimize` (GPO) | Minimize/close additionally locks the vault |

### Data Flow: Save Secret

1. User creates a secret in the frontend (`Ctrl+N` → form).
2. Frontend calls `add_entry({ input })`.
3. `vault-core` creates `SecretEntry`, serializes payload as JSON (in `Zeroizing<Vec<u8>>`).
4. Payload is encrypted with AES-256-GCM and written atomically to the `.oxid` file (`persist()` without `entries.clone()`).
5. Frontend receives only `SecretEntrySummary` (without secret fields).

### Data Flow: Edit Secret (Data Mutation)

1. User selects entry in sidebar → `EntryDetail` shows **metadata** via `get_entry` (`SecretEntryPublic`).
2. Click **Edit** → `NewSecretModal` loads secrets via **`reveal_secret`** (short-lived in form state).
3. User adjusts fields (optional: password generator → direct field apply).
4. Frontend calls `update_entry({ id, input })` — secrets flow **into** the Rust core (input, not list IPC).
5. `vault-core::Vault::update_entry`:
   - Validates input, checks unchanged entry type
   - Keeps `id` + `created_at`, sets new `updated_at`
   - Replaces entry in RAM, calls `persist()` (borrow, no clone)
6. Entire vault body is re-encrypted with AES-256-GCM and written to `.oxid`.
7. Frontend updates sidebar (`list_entries`) and detail view (`get_entry` → Public).

```
Edit → reveal_secret (form) → update_entry → persist(&entries) → AES-256-GCM → .oxid
                              ↓
                    list_entries + get_entry (Public) → sidebar + detail refresh
```

### Data Flow: Delete Secret (Hard Delete)

> **Principle:** OxidVault performs **no soft delete** — deleted secrets leave **no** `deleted` flags or tombstones in the encrypted payload.

1. User opens `EntryDetail` → **Delete** (danger) → `DeleteConfirmationModal` with hard-delete notice.
2. Frontend calls `delete_entry({ id })`.
3. `vault-core::Vault::delete_entry` / `delete_secret(Uuid)`:
   - `zeroize_secrets()` on entry **before** `Vec::remove`
   - `persist()` — atomic rewrite (`.oxid.tmp` → rename) without the entry
   - Audit: `EntryDeleted` (metadata, no secret content)
4. Frontend clears selection → overview; with active Git sync: `sync_vault_git` pushes the changed `.oxid` snapshot.

```
Detail → delete_entry → zeroize → remove from Vec → persist (atomic) → .oxid without entry
                                              ↓
                              optional: sync_vault_git → commit/push
```

### Data Flow: SSH Quick Connect

> **Status:** ✅ `russh` via `RusshProvider` · `src-tauri/src/ssh/` · `SshTerminalPanel` · Command-await (Option B)

```
Quick Connect (entry_id)
        │
        ▼
ssh_connect (async) ──► Vault::extract_ssh_credentials(id)  [key stays in Rust RAM, Zeroizing]
        │                        │
        │                        ▼
        │              open_interactive_shell()  [blocks until handshake complete]
        │                        │
        │                        ├── check_server_key → SHA-256 fingerprint (OpenSSH format)
        │                        ├── TCP → pubkey auth → PTY (want_reply) → shell (want_reply)
        │                        ├── tokio::time::timeout(15s) — auth/shell steps
        │                        └── errors → generic Err(String) to frontend (setError)
        │
        │  Host key check (after handshake):
        │                        ├── no stored fingerprint → `UnknownHost` (pending session)
        │                        ├── fingerprint matches → `Connected`
        │                        └── fingerprint mismatch → `HostKeyMismatch` + immediate disconnect
        │
        │  on UnknownHost: UI dialog → `ssh_trust_host` (persist + promote) | `ssh_reject_host`
        │
        │  on Connected:
        │                        ▼
        │              async_runtime::spawn → run_session_loop (I/O loop)
        │                        │
        │                        ├──► Tauri event `ssh-data` (stdout/stderr, base64)
        │                        └──► Tauri event `ssh-closed` (EOF / exit / runtime error)
        ▼
SshTerminalPanel (xterm.js)  [split view beside vault, optional fullscreen]
        │
        ├── ssh_begin_streaming → backlog + live events
        ├── listen(`ssh-data`) → term.write()
        ├── onData → ssh_write(session_id, stdin)
        └── close → confirmation dialog → ssh_disconnect (graceful channel.close)
```

| Aspect | Detail |
|---|---|
| **SSH crate** | `russh` 0.61+ (`ring`, `flate2`; no `rsa` feature — Marvin audit) |
| **Provider abstraction** | `ssh/provider/` — trait `SshConnection`, `RusshProvider` (russh); `SshManager` delegates connect/I/O |
| **Credentials** | `Vault::extract_ssh_credentials` — private key **never** to frontend; IPC only `entry_id` |
| **Key loader** | `src-tauri/src/ssh/key_loader.rs` — PEM/PPK validation, format-specific parsing; **no key in source** |
| **Logging** | No debug/warn logging in SSH module; errors only as generic UI strings (no keys/passphrases) |
| **Public key auth** | Explicit `authenticate_publickey`; Ed25519/ECDSA via `ring`; optional RSA hash fallback only via `best_supported_rsa_hash` (sha2-512 → sha2-256 → legacy), without `rsa` crate |
| **Handshake** | **Command-await:** `ssh_connect` returns only after auth + shell open; no fire-and-forget |
| **Timeout** | 15s (`SSH_HANDSHAKE_TIMEOUT`) for connect/auth/PTY/shell — prevents hung UI |
| **PTY/shell** | `request_pty(true, cols, rows)` with frontend estimate (`estimateInitialPtySize`) + `ssh_resize_pty` after xterm-fit; `request_shell(true)` |
| **Terminal UI** | `@xterm/xterm` + `@xterm/addon-fit`; pixel-based split + ResizeObserver; focus mode (overlay); close with confirmation |
| **Session status** | UI: `connecting` \| `active` \| `disconnected` — green status dot when session active |
| **Session end** | Server `exit` → `ssh-closed` → panel closes; manual → `SessionInput::Close` + `channel.close()` |
| **Host key verification** | TOFU + known hosts: `known_host_fingerprint` in `ssh_key` payload (encrypted); IPC only `has_known_host_fingerprint: bool` |
| **Pending sessions** | Unknown host: shell open, I/O buffered until `ssh_trust_host` / `ssh_reject_host`; cleanup on vault lock (`disconnect_all_ssh`) |
| **Vault lock** | `lock_vault` → `disconnect_all_ssh()` — graceful close for all sessions (incl. pending) |
| **Key security** | No key in source; `Zeroizing` for key + passphrase in `ssh_connect` and `SshManager::connect` |

**Tauri Commands:** `ssh_connect`, `ssh_trust_host`, `ssh_reject_host`, `ssh_clear_host_fingerprint`, `ssh_begin_streaming`, `ssh_write`, `ssh_resize_pty`, `ssh_disconnect`  
**Tauri Events:** `ssh-data`, `ssh-closed`

### Data Flow: Web Login — Open Website

> **Status:** ✅ `open_website_url` · `src/lib/openWebsite.ts` · Button in `EntryDetail`

```
Open website (web login entry)
        │
        ▼
Frontend: validateHttpUrl(url)     [Client-Vorprüfung, ggf. https:// ergänzen]
        │
        ▼
open_website_url(url)              [Tauri Command]
        │
        ├── normalize_http_url()   [https:// voranstellen wenn kein Scheme]
        ├── validate_http_url()    [Rust: url::Url, nur http/https]
        └── open::that(url)        [Standard-Browser des OS]
```

| Aspect | Detail |
|---|---|
| **UI** | Button **"Open website"** (↗) next to URL field in `EntryDetail` |
| **Theme** | CSS variables (`vault-accent`, `vault-border`) — matches all themes |
| **Validation (frontend)** | `validateHttpUrl()` — auto-`https://` for bare domains, then scheme/host check |
| **Validation (backend)** | `normalize_http_url()` + `validate_http_url()` — authoritative check before OS call |
| **Auto protocol** | Missing `http://`/`https://` and no other scheme → prepend `https://` (e.g. `google.de` → `https://google.de`) |
| **Allowed schemes** | Only `http://` and `https://` — no `javascript:`, `file:`, `data:` etc. |
| **Injection protection** | Trim, reject control characters/whitespace, `url::Url::parse` + scheme whitelist |
| **Browser open** | Rust crate `open` (via Tauri shell stack) — no `window.open` in WebView |

**Tauri Command:** `open_website_url`  
**Capability:** `shell:allow-open` (already in `capabilities/default.json`)

### Live Ping & Service Status (Infrastructure)

> **Status:** ✅ `check_entries_reachability` · `vault-core/probe.rs` · `useReachabilityPolling` · `ReachabilityDot`

```
Frontend (alle 10s, non-blocking)
        │
        ▼
check_entries_reachability(entry_ids[])
        │
        ├── Vault::probe_target_for_entry(id) → resolve_probe_target()
        │       web_login  → URL → Host + Port (80/443)
        │       ssh_key    → Host + Port (22 oder :Port)
        │       database   → Host + konfigurierter Port
        │
        └── tokio::spawn (parallel) → tcp_reachable(host, port)
                Timeout: 3s · Kein ICMP (Admin-Rechte) · TCP-Handshake
        │
        ▼
EntryReachabilityStatus { status: online | offline | unsupported }
        │
        ▼
ReachabilityDot — sidebar + detail view
```

| Aspect | Detail |
|---|---|
| **Method** | Async TCP connect (`tokio::net::TcpStream`) — cross-platform, no ICMP |
| **Interval** | 10 seconds (`useReachabilityPolling`), while vault unlocked |
| **Parallelism** | Per entry separate `tokio::spawn` — does not block UI |
| **Fault tolerance** | Timeouts/host unreachable → `offline`; join errors → silently ignored; app never crashes |
| **UI status** | Gray pulsing = checking · Green pulsing = online · Red = offline |
| **Probeable types** | `web_login`, `ssh_key`, `database` — API/WiFi/note: no dot |

**Tauri Command:** `check_entries_reachability`

### Data Flow: Unlock Vault

1. User enters master password (and optionally TOTP code) in frontend.
2. Frontend calls `open_vault` / `unlock_vault` with `password` and optional `mfaCode`.
3. Tauri command forwards to `vault-core::auth::unlock_vault` (`Zeroizing<String>` for both parameters).
4. **Atomic authentication:** Decryption only in ephemeral stack memory (`EphemeralDecrypt` with `Drop` zeroizing). Password check → optional MFA check → only then commit `VaultHandle`.
5. **Without MFA:** `UnlockVaultResponse { unlocked: true }` — keys/entries applied to `Vault`.
6. **With MFA, no code:** `AuthError::MfaRequired` → `UnlockVaultResponse { mfaRequired: true }` — **no** key material on `Vault`, no `PendingUnlock`.
7. **With MFA + code:** repeat call with `password` + `mfaCode` — atomic full unlock in one step.
8. On error (`InvalidPassword`, `InvalidMfa`): immediate abort, ephemeral memory zeroized.

**v3 unlock addition (`unlock_vault_as_user`):**

1. Password → derive user KEK → unwrap shared DEK → store `session_kek` in RAM.
2. MFA (if active in `VaultUser` header): decrypt TOTP secret with KEK → verify code (TOTP account internally: `{vault_name}/{username}`; display label: `OxidVault:{vault}:{user}`).
3. On MFA failure before commit: KEK/DEK are not persisted on `Vault`.
4. Enable/disable MFA: TOTP secret KEK-encrypted in plaintext header; **v4 re-encrypts payload** (header bound via AAD).

**Limitation (documented honestly):** TOTP gates the **application unlock flow** only — it is **not** a second cryptographic factor for the vault file. An attacker with a copy of the `.oxid` file can brute-force the master password offline and bypass TOTP entirely. A **strong master password** (length, entropy, blocklist) remains the actual file-level defense.

---

## 6. API Interfaces (Tauri Commands)

> All commands run in the Rust backend and return `Result<T, String>`. Most are **synchronous**; a few I/O-heavy commands (`trigger_git_sync`, `sync_vault_git`, `ssh_connect`) are **async** — see the Status column.

### Vault Lock Guard (Sensitive Commands)

| Aspect | Detail |
|---|---|
| **Module** | `src-tauri/src/commands/vault_guard.rs` |
| **API** | `ensure_vault_unlocked(&State<AppState>)` · `ensure_vault_unlocked_state(&AppState)` |
| **Check** | `AppState::is_vault_unlocked()` → `initialized && !locked` |
| **Error** | `Err("Vault locked")` — stable message for frontend abort |
| **Protected commands** | `enable_mfa`, `disable_mfa`, `reencrypt_vault`, `update_git_sync_settings`, `save_ssh_passphrase`, `remove_ssh_passphrase`, `trigger_git_sync`, `sync_vault_git` |
| **Convention** | New security/sync commands: first line `ensure_vault_unlocked(&state)?` |

| Command | Parameters | Return | Description | Status |
|---|---|---|---|---|
| `health_check` | — | `String` | Backend liveness probe (`"ok"`) | ✅ |
| `get_vault_info` | — | `VaultInfo` | Metadata of current vault | ✅ |
| `bootstrap_vault` | — | `VaultInfo` | App start: load saved vault path (if file exists) | ✅ |
| `detach_vault` | — | `()` | Reset in-memory vault (for "Open another vault") | ✅ |
| `create_vault` | `path`, `name`, `password` | `VaultInfo` | New `.oxid` file; password → `Zeroizing<String>` | ✅ |
| `open_vault` | `path`, `password`, `mfa_code?` | `UnlockVaultResponse` | Atomic auth flow via `auth::unlock_vault`; password/code → `Zeroizing<String>` | ✅ |
| `unlock_vault` | `password`, `mfa_code?` | `UnlockVaultResponse` | Re-unlock; same atomic flow | ✅ |
| `lock_vault` | — | `VaultInfo` | RAM purge + cancel clipboard timer | ✅ |
| `touch_activity` | — | `()` | Idle lock: report UI/client activity to backend (only when unlocked) | ✅ |
| `list_entries` | — | `SecretEntrySummary[]` | Entry list without secrets | ✅ |
| `add_entry` | `input: SecretEntryInput` | `SecretEntrySummary` | Add secret and persist vault | ✅ |
| `update_entry` | `id`, `input: SecretEntryInput` | `SecretEntrySummary` | Update secret and persist (zero-clone) | ✅ |
| `delete_entry` | `id: String` | `()` | Secret **hard delete** (physical removal + zeroizing + atomic persist) | ✅ |
| `get_entry` | `id: String` | `SecretEntryPublic` | Metadata without plaintext secrets | ✅ |
| `reveal_secret` | `entry_id`, `field?` | `RevealedSecret` | Short-lived plaintext + warning | ✅ |
| `copy_to_clipboard` | `entry_id`, `field?` | `()` | OS clipboard via `arboard`, 30s Rust clear | ✅ |
| `generate_password_cmd` | `options: PasswordGenOptions` | `String` | CSPRNG password generation (no vault required) | ✅ |
| `take_extension_new_secret` | `()` | `Option<String>` | One-shot password from extension prefill (bridge) | ✅ |
| `open_website_url` | `url: String` | `()` | Open validated http(s) URL in default browser | ✅ |
| `check_entries_reachability` | `entry_ids: String[]` | `EntryReachabilityStatus[]` | Async TCP reachability for infrastructure entries | ✅ |
| `audit_vault_security` | — | `SecurityAuditReport` | Offline password audit (duplicates, weakness, score) | ✅ |
| `get_audit_logs` | `limit: usize` | `AuditLogEntry[]` | Latest compliance audit entries from `{vault}.audit.log` (newest first) | ✅ |
| `export_audit_log` | `target_path`, `format` | `()` | Verify hash chain, export audit report as JSON or CSV | ✅ |
| `get_compliance_status` | — | `ComplianceStatus` | GPO, audit chain, key age, vault format version | ✅ |
| `get_system_diagnostics` | — | `SystemDiagnostics` | Admin support snapshot: vault path (UNC), GPO policy, audit log writability, version — **no secrets** | ✅ |
| `enable_mfa` | — | `MfaSetupInfo` | TOTP enrollment — **vault lock guard** | ✅ |
| `get_mfa_status` | — | `MfaStatus` | `{ mfaEnabled, vaultLocked }` — no secret over IPC | ✅ |
| `disable_mfa` | — | `()` | Disable MFA — **vault lock guard** | ✅ |
| `verify_mfa_code` | `code: String` | `bool` | TOTP validation (RFC 6238, offline); on enrollment → encrypted persistence in vault payload | ✅ |
| `reencrypt_vault` | `current_password`, `new_password` | `()` | Rotate master key container — **vault lock guard** | ✅ |
| `get_app_settings` | — | `AppSettings` | Load local app settings | ✅ |
| `mark_import_offered` | `vault_path: String` | `AppSettings` | Append vault path to `importOfferedPaths` in `settings.json` | ✅ |
| `get_resolved_config` | — | `ResolvedConfig` | Effective policy (user + admin GPO, UI `disabled`) | ✅ |
| `update_git_sync_settings` | `enabled`, `remote_url?`, `ssh_key_path?`, `https_username?`, `https_password?` | `AppSettings` | Git sync configuration — **vault lock guard** | ✅ |
| `update_auto_lock_seconds` | `seconds: u32` | `AppSettings` | Auto-lock timer (0/60/300/600/900/1800) — **vault lock guard** | ✅ |
| `trigger_git_sync` | — | `GitSyncResult` | `git2` pull → commit/push — **vault lock guard** | ✅ async |
| `save_ssh_passphrase` | `passphrase: String` | `()` | SSH key passphrase in OS keyring — **vault lock guard** | ✅ |
| `remove_ssh_passphrase` | — | `()` | Remove SSH key passphrase from keyring — **vault lock guard** | ✅ |
| `sync_vault_git` | — | `GitSyncResult` | Alias of `trigger_git_sync` — **vault lock guard** | ✅ async |
| `ssh_connect` | `entry_id: String`, `cols: u32`, `rows: u32` | `SshConnectResponse` | SSH session — **async**; host key TOFU/known hosts | ✅ async |
| `ssh_trust_host` | `entry_id`, `session_id`, `fingerprint` | `SshSessionInfo` | Activate pending session + persist fingerprint | ✅ |
| `ssh_reject_host` | `session_id` | `()` | Cancel pending session | ✅ |
| `ssh_clear_host_fingerprint` | `entry_id` | `()` | Delete stored host key fingerprint | ✅ |
| `ssh_write` | `session_id`, `data: String` | `()` | Send terminal stdin to SSH channel | ✅ |
| `ssh_disconnect` | `session_id: String` | `()` | End SSH session | ✅ |
| `create_vault_v3` | `path`, `vault_name`, `admin_username`, `admin_password` | `VaultInfo` | New v3 vault with first admin user; passwords → `Zeroizing<String>` | ✅ |
| `attach_vault_path` | `path` | `VaultInfo` | Attach vault file (locked) — user list for v3 login | ✅ |
| `unlock_vault_as_user` | `username`, `password`, `mfa_code?` | `UnlockVaultResponse` | v3 unlock as specific user | ✅ |
| `list_vault_users` | — | `VaultUserPublic[]` | All users (no secrets) — works even when v3 vault locked | ✅ |
| `add_vault_user` | `new_username`, `new_password`, `role` | `VaultUserPublic` | Add user (admin) — **vault lock guard** + **CE user limit** (`license_limit_exceeded`) | ✅ |
| `remove_vault_user` | `username` | `()` | Remove user (admin) — **vault lock guard** | ✅ |
| `change_user_password` | `current_password`, `new_password` | `()` | Change own password — **vault lock guard** | ✅ |
| `migrate_vault_to_v3` | `current_password`, `admin_username` | `VaultInfo` | v1/v2 → v3 migration — **vault lock guard** | ✅ |
| `get_current_user` | — | `VaultUserPublic?` | Currently logged-in user — **vault lock guard** | ✅ |
| `get_license_info` | — | `LicenseInfo` | Active license (CE/EE) — **no vault lock** | ✅ |

### Types

#### `VaultInfo` (Rust ↔ TypeScript)

```json
{
  "version": "1.0.0",
  "name": "Mein Vault",
  "path": "C:/Users/admin/vault.oxid",
  "entry_count": 3,
  "locked": false,
  "initialized": true
}
```

| Field | Type | Description |
|---|---|---|
| `version` | `string` | Vault core version |
| `name` | `string` | Display name of vault |
| `path` | `string \| null` | Path to `.oxid` file |
| `entry_count` | `number` | Number of stored entries |
| `locked` | `boolean` | `true` = vault locked |
| `initialized` | `boolean` | `true` = vault file loaded/created |
| `is_multi_user` | `boolean` | `true` = format v3 (multi-user) |

#### `UnlockVaultResponse` (Rust ↔ TypeScript)

```json
{
  "unlocked": false,
  "mfaRequired": true,
  "isMultiUser": false,
  "currentUsername": null,
  "vault": { "...": "VaultInfo" }
}
```

| Field | Type | Description |
|---|---|---|
| `unlocked` | `boolean` | `true` = vault fully unlocked |
| `mfaRequired` | `boolean` | `true` = repeat call with `password` + `mfaCode` required |
| `isMultiUser` | `boolean` | `true` = v3 vault — on `open_vault` without username: login form with user selection |
| `currentUsername` | `string \| null` | Logged-in v3 user after successful unlock |
| `vault` | `VaultInfo` | Current vault status (still `locked: true` during MFA pending) |

#### `VaultUserPublic` (Rust ↔ TypeScript)

> Public metadata only — **no** `wrapped_dek_*`, `mfa_*`, or `kdf_salt` over IPC.

```json
{
  "username": "alice",
  "role": "admin",
  "mfaEnabled": true,
  "createdAt": 1719302400,
  "passwordChangedAt": 1719302400,
  "isCurrentUser": true
}
```

| Field | Type | Description |
|---|---|---|
| `username` | `string` | Unique login name |
| `role` | `"admin" \| "member"` | Permission level |
| `mfaEnabled` | `boolean` | TOTP active for this user |
| `createdAt` | `number` | Unix timestamp (seconds) |
| `passwordChangedAt` | `number` | Last password change |
| `isCurrentUser` | `boolean` | `true` = currently logged-in user |

#### Secret Types (`SecretPayload` — on-disk / Rust RAM)

> **Status:** ✅ Implemented in `crates/vault-core/src/entry.rs`  
> Serialization as **internally-tagged JSON** with `"type"` field (flat in `SecretEntry` via `#[serde(flatten)]`).  
> **IPC note:** Over Tauri, **`SecretEntryPublic`** / **`SecretPayloadPublic`** are delivered — sensitive fields replaced by `has_password`, `has_token`, …

| `type` | Label | Required fields (vault RAM) | IPC public (frontend) |
|---|---|---|---|
| `web_login` | Web login | `url`, `username`, `password` | `url`, `username`, `has_password`, `has_notes` |
| `ssh_key` | SSH key | `host`, `username`, `private_key`, `known_host_fingerprint?` | `host`, `username`, `has_private_key`, `has_passphrase`, `has_known_host_fingerprint` |
| `api_token` | API token | `service`, `token` | `service`, `has_token` |
| `database` | Database | `host`, `port`, …, `password` | Metadata + `has_password` |
| `network_wifi` | Network / WiFi | `ssid`, `encryption_type`, `password` | `ssid`, `encryption_type`, `has_password` |
| `secure_note` | Secure note | `content` | `preview?`, `has_content` |

#### `SecretField` (Reveal / Clipboard)

| Value | Usage |
|---|---|
| `primary` | Default secret of entry type (default for `reveal_secret` / `copy_to_clipboard`) |
| `password` | Web login, DB, WiFi |
| `token` | API token |
| `private_key` | SSH private key |
| `passphrase` | SSH passphrase |
| `content` | Secure note |
| `notes` | Web login notes (sensitive — not in public IPC) |

#### `RevealedSecret`

```json
{
  "value": "…",
  "warning": "Dieser Wert wurde kurzzeitig entschlüsselt. …"
}
```

#### `MfaSetupInfo` (2FA enrollment — placeholder)

```json
{
  "accountLabel": "OxidVault:Mein Vault",
  "otpauthUri": "otpauth://totp/OxidVault:Mein%20Vault?secret=…&issuer=OxidVault",
  "qrCodePngBase64": "iVBOR…"
}
```

> **Status:** ✅ Implemented in `vault-core/mfa.rs` — TOTP secret AES-256-GCM in vault payload (`StoredMfaConfig`), offline via `totp-rs` + `qrcode`.

**Limitation (documented honestly):** Same as unlock flow above — TOTP protects the running app, not the on-disk file against offline password attacks.

#### `MfaStatus`

```json
{
  "mfaEnabled": true,
  "vaultLocked": false
}
```

#### Secret Types — On-Disk Examples (`SecretPayload`)

```json
{
  "id": "uuid",
  "title": "GitHub Prod",
  "type": "web_login",
  "url": "https://github.com",
  "username": "devops",
  "password": "…",
  "notes": "2FA in Bitwarden",
  "created_at": "1718800000",
  "updated_at": "1718800000"
}
```

**Example `ssh_key`:**

```json
{
  "id": "uuid",
  "title": "Prod Bastion",
  "type": "ssh_key",
  "host": "10.0.0.1",
  "username": "deploy",
  "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
  "passphrase": "…",
  "known_host_fingerprint": "SHA256:abc123…"
}
```

> `known_host_fingerprint` is optional (`null` / missing on create). Set after first connection and confirmation in unknown-host dialog (`ssh_trust_host`); checked against stored value on reconnect.

**Example `api_token`:**

```json
{
  "id": "uuid",
  "title": "Stripe Live",
  "type": "api_token",
  "service": "Stripe",
  "token": "sk_live_…"
}
```

**Example `database`:**

```json
{
  "id": "uuid",
  "title": "Prod PostgreSQL",
  "type": "database",
  "host": "10.0.0.5",
  "port": 5432,
  "db_type": "postgresql",
  "database_name": "app",
  "username": "admin",
  "password": "…"
}
```

**Example `network_wifi`:**

```json
{
  "id": "uuid",
  "title": "Office WLAN",
  "type": "network_wifi",
  "ssid": "CorpNet",
  "encryption_type": "wpa2",
  "password": "…"
}
```

**Example `secure_note`:**

```json
{
  "id": "uuid",
  "title": "nginx.conf",
  "type": "secure_note",
  "content": "server { listen 443 ssl; … }"
}
```

**`db_type` values (dropdown):** `postgresql`, `mysql`, `mariadb`, `mssql`, `sqlite`, `mongodb`, `redis`, `oracle`, `other`  
**`encryption_type` values (dropdown):** `wpa3`, `wpa2`, `wpa`, `wep`, `open`, `enterprise`, `other`

#### `SecretEntrySummary` (List View)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID |
| `title` | `string` | Display name |
| `folder` | `string?` | Optional main category / folder |
| `tags` | `string[]` | Optional labels (normalized, deduplicated) |
| `entry_type` | `web_login \| ssh_key \| api_token \| database \| network_wifi \| secure_note` | Type for sidebar icon |
| `subtitle` | `string?` | URL (web), host (SSH), service (API), DB/WiFi info, note preview |
| `username` | `string?` | Username (web login, SSH key, database) |
| `updated_at` | `string` | Unix timestamp (seconds) |

### Password Expiry / Compliance (v0.1.0)

> **Status:** ✅ `expires_at` on `SecretEntry` · `vault-core/expiry.rs` · `ExpiryBadge` · security dashboard tile

| Aspect | Detail |
|---|---|
| **Data model** | `expires_at: Option<String>` on `SecretEntry` / `SecretEntryInput` — format `YYYY-MM-DD` |
| **Encryption** | Field part of JSON body → AES-256-GCM like all secret metadata |
| **Form** | `NewSecretModal`: optional HTML `type="date"` field "Expiry date / Valid until" |
| **Detail view** | `ExpiryBadge` under title — red when expired, amber when ≤ 14 days |
| **Date calculation** | Pure calendar days (`YYYY-MM-DD`), local date — no UTC offset |
| **Security dashboard** | Fourth tile "Expiring passwords" + to-do list at bottom of dashboard |
| **Audit backend** | `security_audit.rs` + `expiry.rs` — `expiring_entries` with `status`: `expired` \| `expiring_soon` |

### Real-Time Search (v0.1.0)

> **Status:** ✅ `src/lib/search.ts` · sidebar filter in `App.tsx`

| Aspect | Detail |
|---|---|
| **Trigger** | Typing in search field or `Ctrl+K` |
| **Filtering** | Client-side, real-time (no backend roundtrip) |
| **Fields** | Title, folder, tags, URL/host/service (`subtitle`), username, type label |
| **Token logic** | Multiple words = AND (all must match) |
| **Display** | Match counter `3/12` with active search/tag, "No matches" on empty result |

### Folders & Tags (v0.1.0 — Round 2)

> **Status:** ✅ `folder` + `tags` on `SecretEntry` · AES-256-GCM in `.oxid` · `SidebarTagFilter` · `SidebarEntryList`

| Aspect | Detail |
|---|---|
| **Data model** | `folder: Option<String>`, `tags: Vec<String>` on `SecretEntry` / `SecretEntryInput` / `SecretEntrySummary` |
| **Encryption** | Fields part of JSON body → AES-256-GCM like all other secret metadata |
| **Normalization** | Folder trimmed; tags deduplicated (case-insensitive), empty values discarded |
| **Form** | `NewSecretModal`: folder text field + `TagInput` (badges, Enter/comma to add) |
| **Tag filter** | Collapsible sidebar menu under search — clickable badges (`--color-vault-tag`, Dracula: pink `#ff79c6`) |
| **Folder grouping** | When at least one entry has a folder: collapsible folder headings in sidebar |
| **Filter logic** | `filterEntries(entries, query, activeTag, dashboardFilter)` — tag, text search, and dashboard filter combinable |

**Example entry with organization:**

```json
{
  "id": "uuid",
  "title": "Prod DB",
  "folder": "Produktion",
  "tags": ["kritisch", "postgres"],
  "type": "database",
  "host": "10.0.0.5",
  "port": 5432
}
```

### Security Audit Dashboard (v0.1.0 — Round 3)

> **Status:** ✅ `audit_vault_security` · `vault-core/security_audit.rs` · `SecurityDashboard.tsx`

| Aspect | Detail |
|---|---|
| **Navigation** | Sidebar tabs **Secrets** / **Security** / **Activity** at top of left pane |
| **Analysis location** | Fully offline in Rust RAM — passwords never leave the process |
| **Response** | Metadata only: IDs, titles, reasons, scores — **no plaintext passwords** |
| **Duplicates** | Grouped by identical secret (web login, DB, WiFi, API token, SSH passphrase) |
| **Weak secrets** | `< 12` characters **or** no digit **or** no special character |
| **Expiring passwords** | `expires_at` set and expired or ≤ 14 calendar days |
| **Score** | 0–100% — deductions for weak share and duplicate instances |
| **Clickable tiles** | Weak / duplicate / expiring tiles filter sidebar (tab **Secrets**) |
| **Filter badge** | `DashboardFilterBar` above entry list — ✕ or tag **All** clears filter |

**Tauri Command:** `audit_vault_security`

**Dashboard → sidebar filter:** `buildDashboardFilter()` in `src/types/dashboardFilter.ts` · `filterEntries(..., dashboardFilter)` in `src/lib/search.ts`

### Sidebar Quick Actions (v0.1.0)

> **Status:** ✅ `SidebarEntryItem.tsx` · hover actions in entry list

| Entry type | Quick actions (sidebar row) |
|---|---|
| `web_login` | **⎘** Copy password (`copy_to_clipboard`, Rust/arboard) · **↗** Open website (`open_website_url`, URL from `subtitle`) |
| `ssh_key` | **▶** Quick connect (`ssh_connect`, key stays in Rust RAM) |
| other | No inline actions (detail view) |

| Aspect | Detail |
|---|---|
| **Visibility** | Actions appear on hover; always visible when entry selected |
| **Design** | Subtle mono icons, theme variables — no visual clutter (Dracula-compatible) |
| **Sidebar width** | `w-80` (320px) — room for tab nav with icons and full DE labels |

#### IPC Types

| Type | Usage |
|---|---|
| `SecretEntryInput` + `SecretPayload` | Input via `add_entry` / `update_entry` (secrets **into** Rust) |
| `SecretEntrySummary` | Sidebar list, return of `add_entry` / `update_entry` |
| `SecretEntryPublic` + `SecretPayloadPublic` | Detail view via `get_entry` — **without plaintext secrets** |
| `RevealedSecret` | Short-term display via `reveal_secret` |
| `SecretField` | Field selection for `reveal_secret` / `copy_to_clipboard` |

### Frontend IPC Mapping

| TypeScript (`src/lib/ipc.ts`) | Tauri Command |
|---|---|
| `healthCheck()` | `health_check` |
| `getVaultInfo()` | `get_vault_info` |
| `bootstrapVault()` | `bootstrap_vault` |
| `detachVault()` | `detach_vault` |
| `createVault(path, name, password)` | `create_vault` |
| `openVault(path, password, mfaCode?)` | `open_vault` → `UnlockVaultResponse` |
| `unlockVault(password, mfaCode?)` | `unlock_vault` → `UnlockVaultResponse` |
| `lockVault()` | `lock_vault` |
| `listEntries()` | `list_entries` |
| `addEntry(input)` | `add_entry` |
| `updateEntry(id, input)` | `update_entry` |
| `deleteEntry(id)` | `delete_entry` |
| `getEntry(id)` | `get_entry` → `SecretEntryPublic` |
| `revealSecret(entryId, field?)` | `reveal_secret` |
| `copyToClipboard(entryId, field?)` | `copy_to_clipboard` |
| `generatePassword(options)` | `generate_password_cmd` |
| `openWebsiteUrl(url)` | `open_website_url` |
| `checkEntriesReachability(entryIds)` | `check_entries_reachability` |
| `auditVaultSecurity()` | `audit_vault_security` |
| `getAuditLogs(limit)` | `get_audit_logs` |
| `exportAuditLog(targetPath, format)` | `export_audit_log` |
| `getComplianceStatus()` | `get_compliance_status` |
| `getSystemDiagnostics()` | `get_system_diagnostics` |
| `reencryptVault(currentPassword, newPassword)` | `reencrypt_vault` |
| `getAppSettings()` | `get_app_settings` |
| `markImportOffered(vaultPath)` | `mark_import_offered` |
| `getResolvedConfig()` | `get_resolved_config` |
| `updateGitSyncSettings(enabled, remoteUrl)` | `update_git_sync_settings` |
| `updateAutoLockSeconds(seconds)` | `update_auto_lock_seconds` |
| `triggerGitSync()` | `trigger_git_sync` |
| `saveSshPassphrase(passphrase)` | `save_ssh_passphrase` |
| `removeSshPassphrase()` | `remove_ssh_passphrase` |
| `syncVaultGit()` | `trigger_git_sync` (Alias) |
| `sshConnect(entryId)` | `ssh_connect` |
| `sshTrustHost(entryId, sessionId, fingerprint)` | `ssh_trust_host` |
| `sshRejectHost(sessionId)` | `ssh_reject_host` |
| `sshClearHostFingerprint(entryId)` | `ssh_clear_host_fingerprint` |
| `sshWrite(sessionId, data)` | `ssh_write` |
| `sshDisconnect(sessionId)` | `ssh_disconnect` |

#### `PasswordGenOptions`

| Field | Type | Default |
|---|---|---|
| `length` | `number` | `24` |
| `uppercase` | `boolean` | `true` |
| `lowercase` | `boolean` | `true` |
| `digits` | `boolean` | `true` |
| `symbols` | `boolean` | `true` |

---

## 7. File Formats

### `.oxid` — OxidVault File Format

> **Status:** ✅ Implemented in `crates/vault-core/src/format.rs` (version **1** legacy · version **2** enterprise with wrapped DEK · version **3** multi-user legacy · version **4** multi-user with header AAD).

**Version 1 (Legacy):**

```
┌──────────────────────────────────────────────┐
│  Header (Klartext)                           │
│  ─ Magic: "OXID" (4 Byte)                    │
│  ─ Format-Version: u16 LE (= 1)              │
│  ─ KDF memory_kib / iterations / parallelism │
│  ─ Salt: 16 Byte                             │
│  ─ Name-Länge: u16 LE + Name (UTF-8)         │
├──────────────────────────────────────────────┤
│  Nonce: 12 Byte                              │
│  Ciphertext + GCM Tag (Payload = entries)    │
└──────────────────────────────────────────────┘
```

**Version 2 (Enterprise — Key Rotation):**

```
┌──────────────────────────────────────────────┐
│  Header (Klartext)                           │
│  ─ … wie v1, Version = 2                     │
│  ─ key_created_at: u64 LE (Unix)             │
│  ─ key_rotated_at: u64 LE (0 = nie rotiert)  │
│  ─ dek_nonce: 12 Byte                        │
│  ─ dek_len: u32 LE + dek_ciphertext (GCM)    │
├──────────────────────────────────────────────┤
│  Payload-Nonce + Ciphertext (unverändert     │
│  bei Key-Rotation kopierbar)                 │
└──────────────────────────────────────────────┘
```

**Version 3 (Multi-User — shared DEK, legacy read-only):**

Same header layout as v4 with `Format-Version = 3`. Payload encrypted **without** header AAD. On first persist, upgraded to v4.

**Version 4 (Multi-User — header-bound payload):**

```
┌──────────────────────────────────────────────────┐
│  Header (Klartext) — also AES-GCM AAD for body   │
│  ─ Magic: "OXID" (4 Byte)                        │
│  ─ Format-Version: u16 LE (= 4)                  │
│  ─ Vault name: u16 LE length + UTF-8 bytes       │
│  ─ key_created_at: u64 LE (Unix)                 │
│  ─ key_rotated_at: u64 LE (0 = nie)              │
│  ─ users_json_len: u32 LE                        │
│  ─ users_json: UTF-8 JSON array of VaultUser[]   │
├──────────────────────────────────────────────────┤
│  Payload-Nonce: 12 Byte                          │
│  Payload-Ciphertext + GCM Tag                    │
│  (AES-256-GCM with AAD = exact header bytes above)│
└──────────────────────────────────────────────────┘
```

| `VaultUser` field (JSON) | Description |
|---|---|
| `username` | Unique login/display name (max. 64 characters) |
| `role` | `member` or `admin` |
| `kdf_*` / `kdf_salt` | Per-user Argon2id parameters + salt (base64) |
| `wrapped_dek_nonce` / `wrapped_dek_ciphertext` | Shared DEK, wrapped with user KEK (base64) |
| `mfa_nonce` / `mfa_ciphertext` | Optional: TOTP secret, encrypted with user KEK |
| `created_at` / `password_changed_at` | Unix timestamps |

**v3/v4 key model:** A random **shared DEK** (32 bytes) encrypts the payload. Each user derives a **KEK** from their own password and wraps the same DEK in their `VaultUser` entry.

**v4 integrity:** `serialize_header_v4()` produces identical bytes for write and read; any header mutation (user add/remove, role change, MFA, key timestamps, per-user password rewrap) requires **payload re-encryption** with a fresh nonce while the vault is unlocked (DEK in RAM).

**v4 downgrade guard:** Encrypted payload JSON includes `"format_version": 4`. After decrypt, must match header version; payload `format_version` > header → `VaultError::FormatDowngrade`. Legacy v1–v3 payloads omit the field.

**Migration:** `Vault::migrate_to_v3` (command name unchanged) writes **v4** directly. Reading v1–v3 remains supported; first persist of a v3 vault upgrades to v4. v1/v2 single-user vaults are unchanged until explicit migration.

**Tampering UX:** GCM cannot distinguish wrong password from tampered header/payload — both return `VaultError::InvalidPassword` (no oracle). Downgrade attempts with mismatched inner `format_version` return `FormatDowngrade`.

| Property | Value |
|---|---|
| **Extension** | `.oxid` |
| **Magic bytes** | `0x4F 0x58 0x49 0x44` (`"OXID"`) |
| **Versioning** | Header version for forward compatibility |
| **Integrity** | GCM auth tag per body block; v4 additionally binds header to payload via AAD |

---

## 8. Frontend Architecture

### Design System

- **Themes:** 4 selectable themes via `data-theme` on `<html>` — three dark themes plus **Oxid Light** (see below)
- **Design tokens:** Tailwind utilities `vault-*` (CSS variables in `globals.css`)
- **Typography:** System sans + monospace
- **Layout:** Header (theme + status) · Main (sidebar + content) · Footer (shortcut hints)

### Dynamic Theme System (v0.1.0)

> **Status:** ✅ `src/lib/theme.ts` · `SettingsMenu` · `localStorage`

| Aspect | Detail |
|---|---|
| **UI** | Gear icon opens fullscreen `SettingsView` (categories: General, Sync, Security) |
| **Mechanism** | `document.documentElement.setAttribute("data-theme", id)` |
| **CSS** | Per theme, `[data-theme="…"]` overrides `--color-vault-*` variables |
| **Persistence** | `localStorage` key `oxidvault-theme` — restore via `initTheme()` in `main.tsx` |
| **Scope** | Entire app: sidebar, detail, modals, toasts (all `vault-*` classes) |

### Internationalization (i18n)

> **Status:** ✅ Full coverage — entire React UI · `src/locales/de.json` + `en.json` (identical keys)

| Aspect | Detail |
|---|---|
| **Framework** | `i18next` + `react-i18next` |
| **Languages** | German (`de`, default) · English (`en`) |
| **Persistence** | `localStorage` key `oxidvault-locale` — restore in `main.tsx` via `@/lib/i18n` |
| **UI selection** | **Language** dropdown in gear menu (`SettingsMenu`) |
| **Fallback** | `fallbackLng: false` — no cross-language fallback; both locale files must be complete |
| **Scope** | Welcome/auth, vault workspace, sidebar, entry detail, secret modal, generator, audit log, security/compliance, rotation, settings, shortcuts, toasts, password import (`import.*`), error and audit label mapping |
| **Audit events** | Backend stays English (`VaultKeyRotated`, …); frontend mapping in `src/lib/auditLogLabels.ts` → `audit.actions.*` |
| **Error mapping** | `src/lib/errors.ts` — Rust error substrings → `errors.*` keys |
| **Type labels** | `src/lib/vaultLabels.ts` — secret types, DB/WiFi options, dashboard filters |
| **Backend** | Unchanged — audit log stores English action IDs; IPC error text translated in frontend |

**Available themes:**

| ID | Name | Character |
|---|---|---|
| `oxid` | Oxid Default | Dark blue, current default design |
| `oxid-light` | Oxid Light | Light (#F3F4F6 / #FFFFFF), text #1F2937, subtle shadows |
| `dracula` | Dracula | Violet/purple accents |
| `nord` | Nord Arctic | Icy blue-gray |

**Flow:**

```
App-Start → initTheme() liest localStorage → data-theme setzen
User selects theme → applyTheme() → localStorage + CustomEvent
All components use bg-vault-* / text-vault-* utilities unchanged
```

### Keyboard Shortcuts

| Shortcut | Action | Status |
|---|---|---|
| `Ctrl+L` | Lock vault | ✅ Implemented |
| `Ctrl+K` | Focus search + select text | ✅ Implemented |
| `Ctrl+N` | New secret | ✅ Implemented |
| `Ctrl+G` | Open password generator | ✅ Implemented |

### Vault Setup Flows (UI)

#### Create New Vault

1. Welcome screen → **Create new vault**
2. Enter master password (+ optional vault name)
3. Save dialog: choose `.oxid` file (`pickVaultSavePath`)
4. Backend (`create_vault`):
   - Generate 16-byte salt (`crypto::random_salt`)
   - Argon2id → 256-bit master key
   - Empty vault body (`&[]`) serialized → `Zeroizing<Vec<u8>>` → AES-256-GCM → write file
5. Status badge: **unlocked** (green) → vault view  
6. Absolute file path saved in `settings.json` (app data) — **path only, no secrets**

#### Open Existing Vault

1. Welcome screen → **Open existing vault**
2. Open dialog: choose `.oxid` file (`pickVaultOpenPath`)
3. Enter master password
4. Backend (`open_vault`):
   - Read salt + KDF parameters from header
   - Argon2id → derive master key
   - AES-256-GCM decrypt (error → wrong password)
5. Status badge: **unlocked** (green) → vault view  
6. Absolute file path saved in `settings.json` (app data)

#### Smart App Start (Last Opened Vault)

1. On start, frontend calls `bootstrap_vault` (parallel to `health_check`).
2. Backend reads `{appDataDir}/settings.json` → field `lastVaultPath`.
3. If file still exists at path: `Vault::attach_locked(path)` — metadata from header, **locked**, no master key in RAM.
4. Frontend skips welcome screen → directly **Unlock** view with path display.
5. If file missing or path invalid: normal welcome screen.
6. On unlock screen: link **"Open another vault"** → `detach_vault` → welcome screen (saved path remains until another vault is opened).

#### Local App Settings (`settings.json`)

| Field | Type | Content |
|---|---|---|
| `lastVaultPath` | `string?` | Absolute path to last opened `.oxid` file |
| `importOfferedPaths` | `string[]` | Vault paths where the first-run import offer was shown or dismissed |
| `gitSync.enabled` | `boolean` | Git sync active/inactive |
| `gitSync.remoteUrl` | `string?` | Remote repository URL or path (e.g. `https://…` or `file://…`) |

**Location:** OS-specific app data directory via `app.path().app_data_dir()` (e.g. `%APPDATA%/com.oxidvault.app/` on Windows).

**Security:** Only file paths and Git remote configuration are persisted — never master passwords, keys, salts, or secret contents.

### Git Synchronization (v0.1.0 — Round 4)

> **Status:** ✅ `trigger_git_sync` · `git2` 0.19 (`vendored-libgit2`, `ssh`) · `SettingsView` · `GitSyncStatusIndicator`

| Aspect | Detail |
|---|---|
| **Trigger** | Manual ↻ button in header (left of status dot), only when sync active |
| **Configuration** | Gear menu → "Git synchronization" section |
| **Flow** | 1. `git pull --ff-only origin` → 2. on local changes `git add -A` → `commit -m "Vault Sync"` → `push` |
| **Repo root** | Directory of `.oxid` file (or `git rev-parse --show-toplevel`) |
| **Initial setup** | `git init -b main` + `remote add origin` if no repository yet |
| **After pull** | `Vault::reload_from_disk()` — unlocked vault re-read (skipped when vault locked) |
| **v3 reload** | `reload_from_disk` keeps `current_user.dek` — only payload re-decrypted; user list read from updated header |
| **Implementation** | In-process via `git2` 0.19 (`vendored-libgit2`, `ssh`) — no external `git` binary |
| **SSH auth** | 1. `ssh-agent` (`Cred::ssh_key_from_agent`) · 2. key file + optional keyring passphrase (`save_ssh_passphrase`) · explicit `.pub` path |
| **Security** | Only the **encrypted** `.oxid` file is transferred; plaintext secrets never leave the process |

**Why Git is safe:** The `.oxid` file is fully encrypted with AES-256-GCM. Even on public Git servers (GitHub, GitLab), secrets are unreadable without the master password.

**Prerequisite:** SSH remote (e.g. `git@github.com:…`) or HTTPS with stored credentials. For SSH: running `ssh-agent` with loaded key **or** passphrase in OS keyring (Settings → Git Sync).

### Secret UI

| Component | Path | Function |
|---|---|---|
| `NewSecretModal` | `src/components/NewSecretModal.tsx` | Create + edit (`mode: create \| edit`), type selection, generator integration |
| `PasswordGenerateButton` | `src/components/PasswordGenerateButton.tsx` | Key icon next to password/token/passphrase fields |
| `PasswordGeneratorModal` | `src/components/PasswordGeneratorModal.tsx` | CSPRNG generator (`Ctrl+G`), field apply via `onApply` |
| `EntryDetail` | `src/components/EntryDetail.tsx` | Metadata + `SecureField` (reveal/copy via Rust IPC) |
| `ReachabilityDot` | `src/components/ReachabilityDot.tsx` | Status dot (online/offline/checking) for infrastructure |
| `useReachabilityPolling` | `src/hooks/useReachabilityPolling.ts` | 10s background polling via `check_entries_reachability` |
| `SecurityDashboard` | `src/components/SecurityDashboard.tsx` | Offline security audit — score, clickable tiles, to-do lists |
| `DashboardFilterBar` | `src/components/DashboardFilterBar.tsx` | Active dashboard filter above sidebar (✕ to clear) |
| `dashboardFilter.ts` | `src/types/dashboardFilter.ts` | Filter types and `buildDashboardFilter()` from audit report |
| `ExpiryBadge` | `src/components/ExpiryBadge.tsx` | Expiry warning in secret detail view |
| `expiry.ts` | `src/lib/expiry.ts` | Calendar date parsing & 14-day logic (frontend) |
| `TagInput` | `src/components/TagInput.tsx` | Badge input for tags (Enter/comma) |
| `SidebarTagFilter` | `src/components/SidebarTagFilter.tsx` | Collapsible tag filter menu in sidebar |
| `SidebarEntryList` | `src/components/SidebarEntryList.tsx` | Entry list with optional folder grouping |
| `SidebarEntryItem` | `src/components/SidebarEntryItem.tsx` | Sidebar row with quick actions + live status |
| `tags.ts` | `src/lib/tags.ts` | Tag collection, filter, folder grouping |
| `SshTerminalModal` | `src/components/SshTerminalModal.tsx` | Integrated xterm.js terminal, theme-aware |
| `AppLogo` | `src/components/AppLogo.tsx` | Square app logo (`/logo.png`) in header & auth screens |
| `ThemeSelector` | `src/components/ThemeSelector.tsx` | *(replaced by SettingsMenu)* |
| `SettingsView` | `src/components/settings/SettingsView.tsx` | Settings page with vertical navigation |
| `SettingsGearButton` | `src/components/SettingsGearButton.tsx` | Gear icon in header |
| `GitSyncStatusIndicator` | `src/components/GitSyncStatusIndicator.tsx` | Header icon: Git sync status (clickable → sync settings) |
| `ClipboardToast` | `src/components/ClipboardToast.tsx` | Toast notice for 30s clipboard auto-clear |
| `SecretTypeIcon` | `src/components/SecretTypeIcon.tsx` | SVG icons for all 6 secret types in sidebar |
| `openWebsite.ts` | `src/lib/openWebsite.ts` | URL validation + IPC to `open_website_url` |
| `ImportWelcomeModal` | `src/components/ImportWelcomeModal.tsx` | One-time offer after new empty vault (import vs. start fresh) |
| `ImportModal` | `src/components/ImportModal.tsx` | 4-step wizard: format → file → confirm → result |

### Password Import (v2.3.0)

> **Status:** ✅ Client-side TypeScript only — **no** new Rust parsers, **no** vault format changes. Secrets are written via existing `add_entry` IPC.

| Aspect | Detail |
|---|---|
| **Entry points** | (1) `ImportWelcomeModal` after `create_vault_v3` when vault has 0 entries · (2) Settings → General → **Import passwords** (`SettingsView`) |
| **First-run flag** | `importOfferedPaths: string[]` in `settings.json` — path appended via `mark_import_offered` when user dismisses welcome or opens import; read on bootstrap via `get_app_settings` |
| **Legacy migration** | One-time `localStorage` keys `oxidvault-import-offered:*` → `mark_import_offered` in `src/lib/importOffered.ts` |
| **File picker** | `pickImportPath(format)` in `src/lib/dialog.ts` — Bitwarden `.json`, all others `.csv` |
| **File read** | `readTextFile` (`@tauri-apps/plugin-fs`) — capability `fs:allow-read-text-file` in `default.json` |
| **i18n** | Namespace `import.*` in `src/locales/de.json` + `en.json` |

**Module layout (`src/import/`):**

| File | Role |
|---|---|
| `types.ts` | `ImportFormat`, `ParsedImportEntry`, `ParsedImportKind` (`web_login` \| `secure_note`) |
| `csv.ts` | RFC 4180-style CSV parser (quoted fields); BOM strip on headers |
| `shared.ts` | Validation, tag/folder helpers, `finalizeParseResult` |
| `bitwarden.ts` | Unencrypted JSON export (`items[]`, type `1` / `login`) |
| `onepassword.ts` | CSV (`Title`, `Website`, `Username`, `Password`, …) |
| `keepass.ts` | KeePass CSV (`Account`, `Login Name`, `Web Site`, `Group`, …) |
| `chrome.ts` | Chrome CSV (`name`, `url`, `username`, `password`) |
| `roboform.ts` | RoboForm CSV — see mapping below |
| `index.ts` | `validateImportFormat`, `parseImportFile`, `buildImportPreview`, `toSecretInput`, `executeImport` |

**Supported formats:**

| Format | Extension | Export hint (UI) |
|---|---|---|
| Bitwarden | `.json` | Tools → Export vault → JSON (unencrypted) |
| 1Password | `.csv` | File → Export → CSV |
| KeePass | `.csv` | File → Export → KeePass CSV (1.x) |
| Chrome | `.csv` | Password Manager → download CSV |
| RoboForm | `.csv` | Extras → Export → Save as CSV |

**Mapping → `add_entry` input:**

| Source (typical) | `web_login` field | Notes |
|---|---|---|
| title / name | `title` | Fallback title if empty |
| url | `url` | Required for `web_login` |
| username / login | `username` | Required for `web_login` |
| password | `password` | Required for `web_login` |
| notes | `notes` | Optional — **supported** on `WebLogin` payload in `vault-core` (`entry.rs`) |
| folder / group | `tags[]` | Single folder → one tag |

**RoboForm CSV columns:** `Name`, `Url`, `MatchUrl`, `Login`, `Pwd`, `Note`, `Folder`, `RfFieldsV2`

| RoboForm column | Mapping |
|---|---|
| `Name` | `title` |
| `Url` | `url` (web login) |
| `MatchUrl` | ignored |
| `Login` | `username` |
| `Pwd` | `password` |
| `Note` | `notes` (web login) or `content` (secure note) |
| `Folder` | `tags` |
| `RfFieldsV2` | Extra column — does not break CSV parsing (header-indexed `cellAt`). If `Note` empty on **web_login** rows, readable plain text from `RfFieldsV2` may be used as `notes` (JSON/binary blobs skipped) |

**RoboForm secure note detection:** If `Pwd` and `Login` are empty and `Note` is non-empty → import as `secure_note` (`title` = `Name`, `content` = `Note`, `tags` = `Folder`). Does not use `RfFieldsV2` for secure notes.

**Validation & deduplication:**

| Rule | Behaviour |
|---|---|
| Skip invalid | `web_login`: requires non-empty `url`, `username`, `password`; skip if both `title` and `password` empty |
| Skip invalid (note) | `secure_note`: requires non-empty `title` and `content` |
| Duplicates | `web_login`: skip if same `title` + `url` (case-insensitive) already in vault · `secure_note`: skip if same `title` already exists |
| Import execution | Sequential `add_entry` per preview row; `entry_count` updated in frontend |

**Verification script:** `scripts/verify-roboform-import.ts` (RoboForm notes, secure note, quoted CSV / `RfFieldsV2`).

### State Management

Currently: Local React state in `App.tsx` with screen flow (`welcome` → `create`/`open` → `vault`; smart start: directly `unlock`).  
File dialogs via `@tauri-apps/plugin-dialog` in `src/lib/dialog.ts` (`pickVaultSavePath`, `pickVaultOpenPath`, `pickImportPath`, audit export paths).

---

## 9. Build, Deployment & Operations

### Production (Release v1.0.0)

**Prerequisites:** Node.js 20+, Rust stable, WebView2 (Windows).

```bash
npm install
npm run icons          # Icons aus logo.png → src-tauri/icons/ (optional, falls Logo geändert)
npm run tauri:build    # Release-Build + MSI/NSIS (Windows: lädt Rust/MSVC-PATH via scripts/tauri-build.ps1)
```

| Artifact | Path (Windows, after successful build) |
|---|---|
| **MSI installer** | `target/release/bundle/msi/OxidVault_1.0.0_x64_en-US.msi` |
| **NSIS setup (.exe)** | `target/release/bundle/nsis/OxidVault_1.0.0_x64-setup.exe` |
| **Portable EXE** | `target/release/oxidvault.exe` |

> **Path note:** Cargo places artifacts in workspace root under `target/` (not under `src-tauri/target/`).

> **Note:** Exact MSI filename follows pattern `{productName}_{version}_x64_{locale}.msi` from `tauri.conf.json` (`productName`: `OxidVault`, `version`: `1.0.0`).

### App Branding & Icons

| Aspect | Detail |
|---|---|
| **Source logo** | `logo.png` (project root, square) |
| **Icon generation** | `npm run icons` → `npx tauri icon logo.png` |
| **Bundle icons** | `src-tauri/icons/` — incl. `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` |
| **tauri.conf.json** | `identifier`: `com.oxidvault.app` · `bundle.icon[]` references generated PNG/ICO/ICNS |
| **Frontend logo** | `public/logo.png` (copy for Vite) · component `AppLogo.tsx` |
| **UI placement** | Header (`Layout.tsx`), welcome screen, login/unlock (`AuthForm`) |
| **Favicon** | `index.html` → `/logo.png` |

### Development

```bash
npm install          # Frontend dependencies
npm run icons        # Regenerate icons from logo.png
npm run tauri:dev    # Desktop app in dev mode (scripts/tauri-dev.ps1)
```

See also [Production (Release v1.0.0)](#production-release-v100) for the final Windows installer build.

### Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 20+ |
| Rust (stable) | 1.85+ |
| WebView2 (Windows) | System-dependent |

### Self-Hosted Operation

OxidVault is designed **offline-first**. Vault files (`.oxid`) reside on the operator's filesystem. For team sync or backup over public Git servers, **Git synchronization** (round 4) is available — the encrypted `.oxid` file can safely live in any Git remote.

See also [Browser Extension — Native Messaging (Phase 1–3)](#10-browser-extension--native-messaging-phase-13) for headless registration and the ping/pong E2E test.

---

## 10. Browser Extension — Native Messaging (Phase 1–3)

> **Status:** ✅ Phase 1 — headless host, stdio protocol, dummy handler (`ping` → `pong`)  
> **Status:** ✅ Phase 2 — Manifest V3 extension, `background.js`, registry script, E2E guide  
> **Status:** ✅ Phase 3 — `content.js` gesture-gated autofill, `get_login` least privilege, eTLD+1 anti-phishing, localhost IPC to GUI  
> **Style:** RoboForm-like — browser extension communicates with desktop app via native messaging, not Tauri IPC.

> **Production:** The extension is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/oxidvault/belagnpfebgljfamjihdoinbcehingjd) (unlisted). Native messaging is registered automatically by the MSI installer.

> **Dev/Debug only:** Manual setup via `register_native_host.ps1` — see subsections below marked *(Dev/Debug)*. Unpacked extensions and local builds require this script; end users on the store + MSI path do not.

> **Quick start (ping/pong, dev/debug):** Exact 3-step guide in [`browser-extension/README.md`](browser-extension/README.md).

### Goal

The browser extension (later phases) enables form autofill and vault integration in the browser. Phase 1 establishes the **backend interface** in Rust: a headless process without WebView that speaks to Chrome/Firefox over stdin/stdout.

### CLI Flag: `--native-messaging`

| Mode | Start | Behavior |
|---|---|---|
| **Normal** | `oxidvault.exe` (GUI) | Tauri window, WebView, full desktop app |
| **Headless** | `oxidvault-nmh.exe` (recommended, Windows) or `oxidvault.exe --native-messaging` | No window, no Tauri builder — native messaging loop only |

On Windows, the host manifest must point to **`oxidvault-nmh.exe`**: the release GUI (`oxidvault.exe`) is built with `windows_subsystem = "windows"`; Chrome/Edge may then not reliably receive stdout responses (ping sent, no `pong` in console).

The entry point in `src-tauri/src/main.rs` checks `std::env::args()` **before** `oxidvault_lib::run()`. With `--native-messaging`, `run_native_messaging()` is called and the process exits after pipe EOF.

```rust
// main.rs (vereinfacht)
if args.contains("--native-messaging") {
    oxidvault_lib::run_native_messaging()?;
    return;
}
oxidvault_lib::run();
```

### Architecture

```mermaid
flowchart LR
    subgraph Browser["Browser (Chrome / Edge)"]
        CS[content.js]
        BG[background.js]
        CS -->|"GET_LOGIN (gesture)"| BG
    end

    subgraph Host["oxidvault-nmh.exe"]
        NM[native_messaging.rs]
    end

    subgraph Desktop["OxidVault GUI"]
        BR[nm_bridge/server.rs]
        V[(Vault RAM)]
        BR --> V
    end

    BG -- "stdio JSON get_login" --> NM
    NM -- "127.0.0.1 IPC" --> BR
    BR -- "username + password" --> NM
    NM -- "stdio JSON" --> BG
    BG -- "credentials" --> CS
```

| Component | Path | Responsibility |
|---|---|---|
| **Binary entry** | `src-tauri/src/main.rs` | CLI branch (GUI) |
| **NM host binary** | `src-tauri/src/bin/native_messaging_main.rs` | Console `oxidvault-nmh.exe` for browser stdio (Windows) |
| **Public API** | `src-tauri/src/lib.rs` | `run_native_messaging()` |
| **Protocol loop** | `src-tauri/src/native_messaging.rs` | Read/write, JSON dispatch (`ping`, `get_login`) |
| **IPC bridge (GUI)** | `src-tauri/src/nm_bridge/` | localhost TCP, session token, vault access |
| **URL matching** | `crates/vault-core/src/url_match.rs` | eTLD+1 host match via `psl` (exact > subdomain); no substring |
| **Extension (MV3)** | `browser-extension/manifest.json` | `nativeMessaging`, service worker, `content_scripts` |
| `background.js` | `connectNative`, `get_login` / `vault_status` / `request_unlock` |
| **Popup** | `browser-extension/popup.html` | Vault status, MFA hint (no secret input) |
| **Content script** | `browser-extension/content.js` | Login form detection; autofill only after trusted `focusin` (no page-load fill) |
| **Host manifest** | `browser-extension/host/com.oxidvault.app.json` | Browser registration (path + `allowed_origins`) |
| **Registry script** | `scripts/register_native_host.ps1` | Writes host manifest + HKCU Chrome/Edge *(dev/debug only — MSI handles production)* |

### Native Messaging Protocol (stdio)

Chrome and Firefox use the same framing for `type: "stdio"`:

1. **Incoming:** 4 bytes **little-endian** `u32` = payload length in bytes, then UTF-8 JSON.
2. **Outgoing:** identical format on **stdout**.
3. **stdout is reserved** — no `println!`, no logging to stdout in headless mode (would break protocol). Errors → `eprintln!` on stderr.

**Guard limits (phase 1):**

| Limit | Value | Purpose |
|---|---|---|
| `MAX_MESSAGE_LEN` | 1 MiB | DoS protection on malformed length header |

### Phase 1/2 Messages

| Request (JSON) | Response (JSON) |
|---|---|
| `{ "action": "ping" }` | `{ "status": "pong" }` |
| `{ "action": "get_login", "url": "<hostname>" }` | see phase 3 |
| `{ "action": "vault_status" }` | `{ "status": "ok"|"locked"|"mfa_failed", "locked": bool, "minimized": bool, … }` — `minimized` true on taskbar minimize **or** tray hide (`!is_visible`) |
| `{ "action": "request_unlock" }` | `{ "status": "ok", "success": true }` — focuses desktop app only when **not** minimized (no password/MFA over NM) |
| `{ "action": "open_new_secret", "password": "…" }` | Opens desktop **New secret** with prefilled password (one-shot, `take_extension_new_secret`) |
| Unknown `action` | `{ "status": "error", "error": "unknown action" }` |
| Invalid JSON | `{ "status": "error", "error": "invalid json: …" }` |

### Phase 3 — `get_login` (Least Privilege)

**Flow:**

1. **`content.js`** (matches `<all_urls>`): detects `input[type=password]` / username fields; on **trusted** `focusin` on a detected field sends `{ type: "GET_LOGIN" }` to the service worker (no autofill on page load).
2. **`background.js`**: reads the hostname from `sender.tab.url` (not from content script), forwards `{ "action": "get_login", "url": "<hostname>" }` via native messaging to `oxidvault-nmh.exe`.
3. **`native_messaging.rs`**: forwards request via localhost IPC to running GUI (`nm_bridge/server.rs`) — **only** when OxidVault desktop is active.
4. **`Vault::find_web_login_for_hostname`**: searches unlocked web logins (`url_match.rs`: exact host > subdomain via eTLD+1), extracts password via `extract_secret` (`Zeroizing`).
5. Response back to extension; **`content.js`** fills user/password fields only on `{ "status": "ok" }` (one fill per navigation; re-arms on SPA URL change).

### Anti-Phishing (extension autofill)

| Control | Implementation |
|---|---|
| **eTLD+1 matching** | `psl` crate — page host must equal entry host or be a subdomain of the entry's registrable domain (`login.github.com` → entry `github.com`; `evilgithub.com` / `github.com.evil.example` → no match) |
| **No-eTLD strict fallback** | IPs, `localhost`, single-label intranet hosts (`nas`) — exact host equality only |
| **Punycode normalization** | Entry host via `url::Url`; page hostname compared lowercase + punycode (`xn--…`) |
| **User gesture** | `content.js` requests credentials only after `focusin` with `event.isTrusted === true` on detected login fields |
| **Sender-tab hostname** | `background.js` derives hostname from `sender.tab.url`; content script cannot override lookup domain |

**`get_login` responses:**

| Status | Meaning |
|---|---|
| `ok` | `{ "status": "ok", "success": true, "username": "…", "password": "…" }` — exactly one matching entry |
| `not_found` | No web login for this domain |
| `locked` | Vault locked — optional `"mfa_required": true` when MFA active |
| `mfa_failed` | Invalid MFA code in desktop app (status only in popup, **no** MFA input in extension) |
| `unavailable` | Desktop app not started / IPC unreachable |
| `error` | Protocol or authorization error |

### Phase 4 — MFA & Unlock Flow (Browser)

> **Status:** ✅ Extension handles `mfa_required` / `mfa_failed`; unlock exclusively in desktop app

**Principle:** The extension **never** requests an MFA code and stores no TOTP. Password and MFA are entered only in the desktop GUI.

**Flow when vault locked:**

1. `get_login` returns `{ "status": "locked", "mfa_required": true|false, "locked": true }`.
2. `content.js` starts `{ "action": "request_unlock" }` (only when not minimized) and polls `{ "action": "vault_status" }` until `{ "success": true, "locked": false }` — then retries autofill.
3. Popup (`popup.html`) shows vault status and MFA hint — without secret input fields.

**MFA hint on cold start:** `settings.json` contains `vaultMfaConfigured` (metadata, no secret), set on MFA enable/disable and successful unlock. Together with in-memory `Vault::mfa` after lock in same session.

**Bridge state:** `AppState.bridge` (`BridgeAuthState`) remembers `mfa_unlock_failed` after `InvalidMfaCode` in `unlock_vault` / `open_vault` — returned by `vault_status` / `get_login` as `mfa_failed`.

### Phase 5 — WASM Password Generator (Extension Popup)

> **Status:** ✅ `vault-generator` + `vault-wasm` (wasm-pack) · popup generator · theme variables · `open_new_secret`

| Component | Path | Role |
|---|---|---|
| **Shared generator** | `crates/vault-generator/` | Single implementation (CSPRNG, Fisher-Yates) — desktop + WASM |
| **WASM bindings** | `crates/vault-wasm/` | `generatePassword(options)` via wasm-bindgen |
| **Build** | `scripts/build-wasm.ps1` | `wasm-pack build` → `browser-extension/pkg/` |
| **Popup** | `browser-extension/popup.html` + `popup.js` | Generator UI, async WASM init, copy, save & autofill |
| **Themes** | `browser-extension/themes.css` | `--color-vault-*` for oxid / oxid-light / dracula / nord |
| **Desktop prefill** | `take_extension_new_secret` + event `extension-new-secret-prefill` | Opens `NewSecretModal` with `initialPassword` (web login) |

**Build (extension):**

```powershell
.\scripts\build-wasm.ps1
```

**Security (bridge + MFA + anti-phishing):**

| Control | Implementation |
|---|---|
| **Local attacker model** | Same-user malware can read the session file and call `get_login` on `127.0.0.1` while the vault is unlocked — ACLs, token rotation, rate limiting, and audit raise cost and leave traces; they do **not** eliminate this class |
| **Session file ACL** | `native_messaging_session.json` — owner-only (`os_protect::OwnerOnly`; `chmod 0600` / single-user DACL) on every write |
| **Token lifecycle** | Random token published when the bridge starts and on each unlock; **not** revoked on lock (pre-lock token remains valid for `vault_status` / `request_unlock` until next unlock); session file deleted on app exit only |
| **Locked dispatch** | While vault locked: only `vault_status` and `request_unlock`; `get_login` and other secret actions return `{ "status": "locked", … }` |
| **Rate limit** | Token bucket — max 10 `get_login` requests/minute per TCP peer → `{ "status": "error", "error": "rate_limited" }` |
| **Audit** | `SecretAutofilled` (entry UUID only) on successful autofill; `BridgeThrottled` on rate-limit trips |
| **Planned Phase 6** | Named pipe with peer verification (replace localhost TCP + shared token file) |

- NM host process has **no** own vault — access only via GUI process with unlocked `AppState`.
- Session file `%APPDATA%/com.oxidvault.app/native_messaging_session.json` contains port + token for the **lifetime of the GUI process** (127.0.0.1 only); deleted on app exit.
- Passwords in Rust via `Zeroizing<String>` until JSON serialization; extension fills fields, does not persist.
- Autofill hostname is taken from `sender.tab.url` in the service worker; vault lookup uses eTLD+1 matching (`psl`), not substring.
- Credentials are filled only after a trusted user `focusin` on a detected login field — never on page load.

### Host Manifest

File: `browser-extension/host/com.oxidvault.app.json`

```json
{
  "name": "com.oxidvault.app",
  "description": "OxidVault Native Messaging Host (Phase 1 — ping/pong)",
  "path": "C:\\Path\\To\\oxidvault-nmh.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID_HERE/"]
}
```

| Field | Note |
|---|---|
| `name` | Must match registry/manifest key (`com.oxidvault.app`) |
| `path` | Absolute path to `target/release/oxidvault-nmh.exe` (console binary; `register_native_host.ps1` sets this automatically) |
| `args` | Omitted for `oxidvault-nmh.exe` (dedicated entry). Legacy: `oxidvault.exe` with `["--native-messaging"]` |
| `allowed_origins` | Extension ID of web extension — set by `register_native_host.ps1` |

### Phase 2 — Extension Skeleton & Registry Script *(Dev/Debug)*

**Extension (`browser-extension/`):**

- `manifest.json` — Manifest V3, permission `nativeMessaging`, background service worker
- `background.js` — on start: `chrome.runtime.connectNative("com.oxidvault.app")`, `postMessage({ action: "ping" })`, listener for `onMessage` / `onDisconnect`, output via `console.log`

**Registry script (`scripts/register_native_host.ps1`)** — not required for production (MSI + Web Store); required when loading an unpacked extension or testing against a local `target/debug` or `target/release` build:

```powershell
.\scripts\register_native_host.ps1 -ExtensionId "<32-character ID from chrome://extensions>"
```

| Action | Detail |
|---|---|
| Binary path | Writes absolute path to `target/release/oxidvault-nmh.exe` in `com.oxidvault.app.json` |
| `allowed_origins` | Sets `chrome-extension://<ExtensionId>/` |
| Registry Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.oxidvault.app` → path to JSON |
| Registry Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.oxidvault.app` → path to JSON |

Optional: `-BuildProfile debug` for `target/debug/oxidvault-nmh.exe`.

### Ping/Pong E2E Test (3 Steps) *(Dev/Debug)*

1. **Build binary:** `cargo build --release`
2. **Load extension:** `chrome://extensions` → developer mode → unpacked extension → folder `browser-extension` → copy extension ID
3. **Register host:** `.\scripts\register_native_host.ps1 -ExtensionId "<ID>"` → reload extension → service worker console: `{ status: "pong" }`

> **Production path:** Install MSI + extension from Chrome Web Store — skip steps 2–3; native messaging is pre-registered by the installer.

Details and troubleshooting: [`browser-extension/README.md`](browser-extension/README.md).

### Web Store Distribution (Unlisted)

> **Status:** ✅ Chrome Web Store (unlisted) · MSI auto-registers native messaging · `scripts/stage-browser-extension.ps1` · `scripts/register_native_host.ps1` *(dev/debug)* · `installer/README.md`

| Aspect | Detail |
|---|---|
| **Distribution** | [Chrome Web Store](https://chromewebstore.google.com/detail/oxidvault/belagnpfebgljfamjihdoinbcehingjd) (unlisted) — upload ZIP via `npm run extension:package` for new releases |
| **Upload artifact** | `installer/dist/OxidVault-extension-<version>.zip` (no CRX, no `update_url` in manifest) |
| **Extension ID** | Assigned by Google on first upload → locally in `browser-extension/extension.id` (gitignored, template: `extension.id.example`) |
| **Manifest** | MV3, `permissions: ["nativeMessaging"]` — no `key`, no `update_url` in store build |
| **Desktop MSI** | Tauri bundle: app + `oxidvault-nmh.exe` — **without** `browser-extension/` in MSI |
| **Native messaging** | **Production:** MSI WiX custom action — automatic HKCU registration (Chrome/Edge). **Dev/debug:** `register_native_host.ps1` (ID from file/parameter/`$env:OXIDVAULT_EXTENSION_ID`) |
| **Updates (store)** | Raise `manifest.json` `version` → new ZIP → developer dashboard |
| **Optional GPO** | `ExtensionInstallForcelist`: `<store_id>;https://clients2.google.com/service/update2/crx` |

**Workflow (maintainers — store upload):**

1. `npm run extension:package` — WASM build + ZIP
2. Upload in [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Save extension ID in `browser-extension/extension.id`
4. `register_native_host.ps1` — **dev/debug only** (`-BuildProfile release` or `installed` when testing MSI layout locally)
5. Optional: enterprise policy with web store update URL (no localhost server)

| **Remote code (web store)** | All JS/WASM code in upload ZIP; WASM via `import.meta.url` + `fetch(chrome-extension://…)` — **no** external JS; `wasm-unsafe-eval` in CSP (no `unsafe-eval`) |

**Web store — "Remote code":** Answer **No**. Password generator loads `pkg/vault_wasm_bg.wasm` from extension package (wasm-bindgen: `new URL('vault_wasm_bg.wasm', import.meta.url)`). Native messaging speaks only to local desktop binary — that is not dynamically loaded JavaScript.

**CSP:** `script-src 'self' 'wasm-unsafe-eval'` — intended by Chrome for local WebAssembly in MV3; does **not** allow `eval()` on strings.

**Chrome** — registry (HKCU):

```
Software\Google\Chrome\NativeMessagingHosts\com.oxidvault.app
  (Default) = Full path to com.oxidvault.app.json
```

**Firefox** — registry (HKCU):

```
Software\Mozilla\NativeMessagingHosts\com.oxidvault.app
  (Default) = Full path to com.oxidvault.app.json
```

After adjusting `path` and `allowed_origins`, the extension can use `chrome.runtime.connectNative("com.oxidvault.app")` or Firefox equivalent.

### Manual Test (Without Extension)

PowerShell (pipe payload length + JSON to stdin):

```powershell
$json = '{"action":"ping"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$len = [BitConverter]::GetBytes([uint32]$bytes.Length)
$input = $len + $bytes
$input | & ".\target\release\oxidvault.exe" --native-messaging
```

Expected stdout response (hex-decoded): 4-byte length + `{"status":"pong"}`.

---

## 11. Audit Logging & Compliance (ISO 27001)

> **Status:** ✅ Append-only compliance log · metadata-only · SHA-256 hash chain · HMAC checkpoints (v2+)  
> **Module:** `crates/vault-core/src/audit.rs`  
> **Password weakness dashboard:** still `crates/vault-core/src/security_audit.rs` (separate module)

### Goal

Logging of security-relevant vault events for ISO 27001-compliant traceability — **without** plaintext secrets in the log. Integrity is layered: a structural hash chain plus optional HMAC checkpoints when a vault session is unlocked.

### Threat model (honest limitations)

| Layer | What it detects | What it does **not** detect |
|---|---|---|
| **SHA-256 hash chain** | Casual line edits, deletions, reordering | A full log rewrite with a recomputed consistent chain |
| **HMAC checkpoints (v2+)** | Full-rewrite forgery by anyone **without** the vault DEK-derived `audit_hmac_key` | Forgery by an attacker who already obtained the DEK (same trust boundary as vault data) |
| **OS ACLs (`audit_secure`)** | Unauthorized read/write of `{vault}.audit.log` on disk | Compromise of an unlocked session or admin with file access + live DEK |

**v1 exclusion:** Legacy v1 vaults have no separate DEK — checkpoints are **not** written. Compliance reports `auditChainAuthenticated: false` with status `audit_no_checkpoints`. Pre-upgrade logs without checkpoint lines behave the same until the next unlocked v2+ session appends checkpoints.

**Checkpoint schedule:** immediately after unlock, on lock, and every 50 metadata events while unlocked. Events during locked state (e.g. `AuthFailed`) have no HMAC; the next unlock checkpoint covers them.

### Privacy Rules (Strict API)

| Rule | Implementation |
|---|---|
| **No secrets in log** | [`AuditAction`](crates/vault-core/src/audit.rs) is an enum — metadata events only; no passwords, usernames, or secret payloads |
| **Entry reference only** | For secret events, only UUID in `entry_id` field (optional title in UI via lookup — **never** persisted in log) |
| **Trait binding** | [`AuditLog::log`](crates/vault-core/src/audit.rs) — `Vault` calls `audit_logger.log(action)` internally |

### AuditAction (Metadata Events)

| Variant | Trigger | Detail field (`entry_id`) |
|---|---|---|
| `VaultCreated` | `Vault::create` | `-` |
| `VaultOpened` | `Vault::open` | `-` |
| `VaultUnlocked { lock_id }` | `Vault::unlock` | Lock ID |
| `VaultLocked` | `Vault::lock` | `-` |
| `SecretCreated { id }` | `Vault::add_entry` | UUID (no password/username) |
| `SecretModified { id }` | `Vault::update_entry` | UUID |
| `EntryDeleted { id }` | `Vault::delete_entry` | UUID |
| `SecretCopied { id }` | `copy_to_clipboard` IPC | UUID |
| `SecretRevealed { id }` | `Vault::reveal_secret` | UUID |
| `VaultKeyRotated` | `Vault::reencrypt_vault` | `-` |
| `AuthFailed` | Failed unlock (wrong master password on `open`/`unlock`) | `-` |
| `SyncEvent { status }` | `sync_vault_git` success/failure | `success` / `failed` |
| `ConfigChanged { area }` | Git sync settings, MFA on/off | e.g. `git_sync`, `mfa_enabled`, `mfa_disabled` |
| `Checkpoint` | Unlock, lock, every 50 events (v2+ unlocked) | `-` + `hmac=<hex>` (HMAC-SHA256 of `entry_hash`) |

**Legacy (read old logs only):** `EntryCreated`, `EntryUpdated` — displayed in frontend as `SecretCreated` / `SecretModified`.

### Traceability vs. Privacy

| Goal | Implementation |
|---|---|
| **Traceability** | Who/when/what at vault level: unlock, secret lifecycle, sync, security-relevant settings |
| **Privacy** | No plaintext credentials; secret events reference UUIDs only; sync/config details without paths or remote URLs |
| **Integrity** | Append-only + SHA-256 hash chain; v2+ adds HMAC checkpoints keyed via `HKDF-SHA256(DEK, info="oxidvault-audit-v1")` |

### Storage Format

| Aspect | Detail |
|---|---|
| **File** | `{vault}.audit.log` next to `{vault}.oxid` (e.g. `team.oxid` → `team.audit.log`) |
| **Write mode** | `OpenOptions::append(true).create(true)` — append-only |
| **Timestamp** | ISO-8601 UTC (`2025-06-20T21:00:00.123Z`) |
| **Line format** | `[TIMESTAMP] [ACTION] [ENTRY_ID] prev_hash=… entry_hash=…` |
| **ENTRY_ID** | UUID or `-` when no entry affected |

**Example:**

```text
[2025-06-20T21:00:00.123Z] [VaultUnlocked] [-] prev_hash=000…000 entry_hash=a1b2…
[2025-06-20T21:00:01.456Z] [EntryCreated] [550e8400-e29b-41d4-a716-446655440000] prev_hash=a1b2… entry_hash=c3d4…
```

### OS-Level Access Protection (ACLs / Permissions)

| Platform | Protection | Details |
|---|---|---|
| **Windows** | Explicit DACL | On create/open of `{vault}.audit.log`: access only for **current Windows user** and **Administrators** (`S-1-5-32-544`); `Everyone`/`Guests` removed; DACL **protected** (no inheritance) |
| **Linux / macOS** | `chmod 0o600` | Read/write for file owner only via `std::os::unix::fs::PermissionsExt` |
| **Startup** | `audit::init()` | Called in `src-tauri/src/main.rs` before app start; self-test with temp file — **abort with error** if OS protection not enforceable |
| **Vault binding** | `AuditLogger::for_vault` | Each `{vault}.audit.log` re-secured on bind (`audit_secure::secure_audit_log_file`) |

**Audit log integrity** (hash chain) requires that unauthorized parties cannot read or tamper with the file — therefore OS-level protection is part of ISO 27001 compliance.

**Module:** `crates/vault-core/src/audit_secure.rs`

### Integrity (Hash Chain)

Each entry contains:

1. **`prev_hash`** — SHA-256 of previous entry (genesis: 64× `0`)
2. **`entry_hash`** — SHA-256 over record string `[TIMESTAMP] [ACTION] [ENTRY_ID] prev_hash=…`

Tampering breaks the structural chain (`verify_audit_chain`); full-rewrite forgery is caught by `verify_audit_chain_keyed` when HMAC checkpoints exist and the DEK-derived key is available.

### Integration in `Vault`

```rust
// vault.rs (vereinfacht)
self.audit_logger.log(AuditAction::SecretCreated { id: entry_uuid })?;
```

Public API for commands: `Vault::record_audit(action, entry_id)`.

### UI Visualization (Activity Log)

> **Status:** ✅ `get_audit_logs` · `AuditLogTable.tsx` · sidebar tab **Activity**

| Aspect | Detail |
|---|---|
| **Navigation** | Sidebar tabs **Secrets** / **Security** / **Activity** |
| **Command** | `get_audit_logs(limit)` — reads `{vault}.audit.log`, parses line format, returns latest `limit` entries (newest first) |
| **Type** | `AuditLogEntry`: `timestampUtc`, `action`, `entryId`, `entryHash` — **no secrets** |
| **Parser** | `vault-core::read_audit_logs(vault_path, limit)` |
| **Timestamp** | UTC in log → local system time in UI (`toLocaleString`) |
| **Actions** | Technical `AuditAction` enums → localized description text (`auditLogLabels.ts`) |
| **Search** | Client-side filter by action, entry ID, hash, formatted timestamp |
| **Security notice** | Info banner: no passwords or usernames in log |
| **Export** | Button **Export** → save dialog (JSON/CSV filter) → `export_audit_log`; button **PDF Export** → save dialog → `generateComplianceReportPdfBlob` + `writeFile` |

---

## 12. Vault Persistence: UNC Paths & Atomic Writes

> **Status:** ✅ `crates/vault-core/src/format.rs` · `crates/vault-core/src/path_util.rs` · `vault.rs`  
> **Goal:** Crash-safe persistence on local drives **and** UNC network shares (`\\server\share\...`)

### UNC Path Handling

| Aspect | Implementation |
|---|---|
| **Module** | `path_util::normalize_vault_path` |
| **Windows UNC** | Preserves `\\server\share\...`; normalizes `//server/share` → `\\server\share` |
| **Integration** | `Vault::create`, `Vault::open`, `Vault::attach_locked` normalize before FS access |
| **PathBuf** | Standard Rust `Path`/`PathBuf` — no string hacking for temp files |

**Example:**

```text
\\fileserver\team\vault.oxid
  → Temp: \\fileserver\team\vault.oxid.tmp   (gleicher Share)
```

### Robust Write Process (`atomic_write_vault`)

| Step | Action | Purpose |
|---|---|---|
| **A** | Write temp file `{dir}/{name}.oxid.tmp` in **same directory** | Atomic `rename` requires same volume/share |
| **B** | `sync_all()` on temp file | Data physically on disk/share |
| **C** | `std::fs::rename(temp → target)` | Atomic replace (local + same SMB share) |
| **D** | **Fallback** on rename failure (e.g. SMB locking): open target (write/truncate) → `std::io::copy` → `sync_all()` → delete temp | Robustness on network shares |

```
write_vault_bytes(.tmp) ──sync──► rename(.tmp → .oxid) ──OK──► done
                                      │
                                   error
                                      │
                                      ▼
                         copy(.tmp → .oxid) ──sync(.oxid)──► remove(.tmp)
```

| Error case | Behavior |
|---|---|
| Temp file write/sync failed | Temp deleted; original unchanged |
| Rename failed, copy+sync succeeded | Target file updated; temp removed |
| Copy/sync failed | Temp deleted; error propagated |

### Compliance Note

The SMB fallback (step D) is intentionally **not** atomic at file level — it applies only when `rename` fails on the share. Steps A–C remain the preferred path for integrity; step D prevents data loss on SMB locks.

### Exclusive Vault File Lock (`lock.rs`)

> **Status:** ✅ `crates/vault-core/src/lock.rs` · `Vault::open()` · `Vault::close()` · `Drop`

Prevents simultaneous open/write of the same `.oxid` file by multiple processes (local or on UNC shares):

| Aspect | Detail |
|---|---|
| **Lock file** | `{vault}.lock` next to `{vault}.oxid` (e.g. `team.oxid` → `team.lock`) |
| **Atomicity** | `OpenOptions::create_new(true)` — only one process wins |
| **Metadata** | JSON: `{ "user", "pid", "host" }` |
| **Stale repair** | On `acquire`: existing lock file → `sysinfo` checks PID on same host → dead → delete lock & retry |
| **Error** | `VaultError::LockedBy(LockMetadata)` — shows who holds vault |
| **Release** | `Vault::close()` or `Drop` on `Vault` |
| **Smart start** | `attach_locked` → `acquire_vault_lock` · `unlock` → `assert_lock_valid` before decryption |
| **Lock lost** | `VaultError::LockLost` — no `unlock` without valid `{vault}.lock` |
| **Audit `VaultUnlocked`** | `entry_id` = lock ID (`user@host:pid`) of active file lock |

```
Vault::open(path)
      │
      ▼
create_new(team.lock) ──OK──► JSON schreiben → Tresor laden
      │
   Exists
      │
      ▼
PID noch aktiv? ──Ja──► LockedBy(user, pid, host)
      │
     Nein (Stale)
      │
      ▼
remove(team.lock) → create_new erneut
```

---

## 13. Centralized Policy Management & Admin GPOs

> **Status:** ✅ `crates/vault-core/src/policy/` · startup in `main.rs` · `get_resolved_config`  
> **Goal:** Machine-wide admin policies (GPO-style) override local user settings

### Policy File (Read-Only for End Users)

| Platform | Path |
|---|---|
| **Windows** | `C:\ProgramData\OxidVault\policy.json` |
| **Linux / macOS** | `/etc/oxidvault/policy.json` |

The file is loaded at app start via `policy::init_admin_policy()` and cached in process. Invalid JSON causes abort (compliance).

**Template for admins:** [`docs/policy.json.example`](../docs/policy.json.example) · **GPO rollout (5 min.):** [Admin Deployment Guide](docs/ADMIN_DEPLOYMENT.md)

**Example `policy.json`:**

```json
{
  "forceLockOnMinimize": true,
  "autoLockSeconds": 60,
  "gitSyncEnabled": false,
  "minMasterPasswordLen": 16
}
```

### Data Model

| Type | Role |
|---|---|
| **`AdminPolicy`** | Only set fields (`Option<T>`) are binding — read-only for user |
| **`UserPolicyPreferences`** | Local values from `settings.json` + defaults |
| **`ResolvedConfig`** | Effective configuration after merge |

### Override Logic

`resolve_config(user)` — for each field:

- Admin field **set** → `value = admin`, `disabled = true` (UI switch locked)
- Admin field **not set** → `value = user`, `disabled = false`

```
settings.json (user)  +  policy.json (admin)  →  ResolvedConfig (effective + UI flags)
```

### Supported Policy Fields

| Field | Effect |
|---|---|
| `forceLockOnMinimize` | Optional lock when hiding to tray (`window_events.rs`) |
| `autoLockSeconds` | Inactivity auto-lock (`idle_worker.rs`); user configurable in Settings → Security; admin GPO overrides |
| `gitSyncEnabled` | Git sync toggle + `sync_vault_git` |
| `minMasterPasswordLen` | Master password validation on `Vault::create` |

### Frontend Binding

| IPC | Return |
|---|---|
| `get_resolved_config` | `ResolvedConfig` with `{ value, disabled }` per field |
| `update_auto_lock_seconds` | Saves user preference in `settings.json` (0 = never); blocked on GPO override |

Frontend uses `disabled: true` to lock UI elements (e.g. Git sync checkbox in `SettingsMenu.tsx`).

### Startup

```rust
// main.rs
vault_core::policy::init_admin_policy()?;
```

---

## 14. Documentation Requirements

### Sync Requirement

For the following changes, this document **must** be updated in the same commit / PR:

- [ ] New or changed **Tauri commands**
- [ ] New or changed **types** (`VaultInfo`, entry types, etc.)
- [ ] **File format** changes (`.oxid` header, versions)
- [ ] **Crypto parameters** (KDF, AEAD, key rotation)
- [ ] **Directory structure** (new crates, modules, plugins)
- [ ] **Architecture decisions** (document ADRs inline)

### Dual-Format Audit Reporting & Integrity Verification

> **Status:** ✅ `audit_export.rs` · `export_audit_log` · export button in tab **Activity**

| Aspect | Detail |
|---|---|
| **Module** | `crates/vault-core/src/audit_export.rs` |
| **Formats** | `ExportFormat::Json` · `ExportFormat::Csv` |
| **API** | `export_audit_report(vault_path, target_path, format) -> Result<PathBuf, VaultError>` |
| **Integrity check** | Before export: `verify_audit_chain` over entire `{vault}.audit.log` — abort with `VaultError::AuditLogCorrupted` on broken hash chain |
| **JSON report** | Object with cryptographic `integrity` header (`reportHash` = SHA-256 over version, timestamp, chain tail hash, entries) plus `entries[]` incl. `prevHash` |
| **CSV report** | Columns: `timestamp_utc`, `action`, `entry_id`, `prev_hash`, `entry_hash` |
| **Tauri command** | `export_audit_log(target_path, format)` — `format`: `"json"` or `"csv"` |
| **PDF report** | `src/lib/pdfExport.ts` → jsPDF + jspdf-autotable in Tauri WebView (no Rust command) |
| **UI** | Save dialog (`dialog::save`) with filter **JSON Audit Report (.json)** / **CSV Audit Report (.csv)**; file extension determines `format`; additionally **PDF Export** (save dialog + `tauri-plugin-fs` `writeFile`) |

### PDF Compliance Report

| Aspect | Detail |
|---|---|
| **Method** | jsPDF + jspdf-autotable in Tauri WebView (frontend) |
| **Offline** | Fully client-side — no network requests |
| **Format** | A4, portrait, OxidVault branding (indigo), logo embedded (optional) |
| **Table** | jspdf-autotable — automatic page breaks, repeating headers |
| **Color coding** | Actions colored (green=unlock, orange=reveal, red=delete) |
| **Footer** | Page number on each page |
| **Save** | Tauri save dialog (`pickAuditPdfExportPath`) + `writeFile` — user chooses target path |
| **Umlauts** | UTF-8, works fully |
| **No Rust deps** | No printpdf, no lopdf, no `patches/` folder |

**JSON integrity header (excerpt):**

```json
{
  "integrity": {
    "reportVersion": "1.0",
    "exportedAtUtc": "2025-06-20T21:00:00.123Z",
    "sourceVaultPath": "C:/vault/team.oxid",
    "sourceLogPath": "C:/vault/team.audit.log",
    "entryCount": 42,
    "chainVerified": true,
    "chainTailHash": "a1b2…",
    "reportHash": "c3d4…"
  },
  "entries": [ … ]
}
```

### Changelog

Full release history: [`CHANGELOG.md`](CHANGELOG.md).

## 15. Key Rotation & Compliance Dashboard

> **Status:** ✅ Format v2 (wrapped DEK) · `Vault::reencrypt_vault` · `compliance.rs` · `src/dashboard/ComplianceDashboard.tsx`

### Key Rotation (Header-Only)

| Aspect | Detail |
|---|---|
| **API** | `Vault::reencrypt_vault(new_password)` → internally `format::rotate_vault_key_container` |
| **Principle** | Password → KEK (Argon2id) · random DEK encrypts payload · DEK in header (wrapped) |
| **Rotation** | New salt + new KEK; DEK unchanged; **payload blob copied 1:1** (v1/v2 only) |
| **Format v4 multi-user** | Per-user password change (`change_own_password`) rewraps DEK in header **and** re-encrypts payload (header AAD binding) |
| **Format v1** | Legacy: master key encrypts payload directly; first rotation migrates to v2 without payload re-encrypt |
| **Format v2 header** | Additionally: `key_created_at`, `key_rotated_at`, `dek_nonce`, `dek_ciphertext` |
| **Audit** | Mandatory event `AuditAction::VaultKeyRotated` |
| **Tauri command** | `reencrypt_vault(current_password, new_password)` — passwords as `Zeroizing<String>` |
| **UI** | `RotationDialog.tsx` — spinner during rotation, success updates compliance dashboard |

```
Old password → KEK_old → unwrap(DEK)
New password → KEK_new → wrap(DEK) → new header
Payload block → copied unchanged (v1/v2 only)
```

**v4 note:** Multi-user vaults use per-user KEK wrapping in `users_json`. Header or user-entry changes always trigger full payload re-encryption with fresh nonce and header AAD.

### Compliance Dashboard (Frontend)

| Aspect | Detail |
|---|---|
| **Module** | `src/dashboard/ComplianceDashboard.tsx` |
| **Placement** | Tab **Security** — above password audit `SecurityDashboard` |
| **Command** | `get_compliance_status` → `ComplianceStatus` |
| **Policy status** | "GPO managed?" — `admin_policy_active()` |
| **Audit status** | Structural: `verify_audit_chain` · Authenticated (unlocked v2+): `verify_audit_chain_keyed` |
| **Key age** | Days since `key_rotated_at` (fallback: `key_created_at`, v1: file mtime) |
| **Hint** | When key age > **90 days**: primary button **Rotate password** → `RotationDialog`; toast + refetch after `reencrypt_vault` |
| **Legacy format** | When `vaultFormatVersion` < 3 (v1/v2): hint + **Migrate to multi-user format** → `MigrateToV3Modal` (password policy exempt on re-wrap) |
| **Compliance badge** | "Compliance OK" (green) when audit chain valid, HMAC checkpoints OK (when applicable), key age ≤ 90 days, and format ≥ v3 |
| **Rotation hint** | Below button: secure key migration (v2), payload stays encrypted |

**`ComplianceStatus` (IPC):**

```json
{
  "policyManagedByGpo": true,
  "auditChainValid": true,
  "auditChainAuthenticated": true,
  "auditAuthenticationStatus": "ok",
  "keyCreatedAt": "2025-03-01T00:00:00+00:00",
  "keyRotatedAt": null,
  "keyAgeDays": 112,
  "keyRotationRecommended": true,
  "vaultFormatVersion": 2,
  "legacyFormatMigrationRecommended": true
}
```

### System Diagnostics (Admin Support)

| Aspect | Detail |
|---|---|
| **Module (Rust)** | `crates/vault-core/src/diagnostics.rs` — `collect_system_diagnostics` |
| **Command** | `get_system_diagnostics` → `SystemDiagnostics` |
| **UI** | `src/components/SystemDiagnosticsPanel.tsx` — tab **Security**, below compliance, above password audit |
| **Export** | Button "Copy diagnostics report" → markdown via `src/lib/diagnosticsReport.ts` |
| **i18n** | Labels `diagnostics.*`; status codes via `formatDiagnosticStatus` in `errors.ts` |

**`SystemDiagnostics` (IPC, camelCase):**

| Field | Type | Check |
|---|---|---|
| `vaultPath` | `VaultPathDiagnostics` | Loaded/saved path, UNC detection, file readable, directory writable |
| `policyStatus` | `PolicyDiagnostics` | GPO path, active, SHA-256 hash, JSON validation |
| `auditLogStatus` | `AuditLogDiagnostics` | `{vault}.audit.log` writable, hash chain (if present) |
| `versionInfo` | `VersionDiagnostics` | `VAULT_VERSION` |

Stable status codes (backend → frontend): `ok`, `vault_not_loaded`, `vault_file_not_found`, `vault_path_not_reachable`, `vault_dir_not_writable`, `policy_not_configured`, `policy_invalid`, `policy_not_readable`, `audit_no_vault`, `audit_not_writable`, `audit_chain_invalid`, `audit_not_present`.

---

## 16. Admin Deployment Guide

IT administrator rollout (MSI, `policy.json`, GPO): [`docs/ADMIN_DEPLOYMENT.md`](docs/ADMIN_DEPLOYMENT.md).

## 17. Licensing Model

| Edition | Users | Features | License |
|---|---|---|---|
| **Community** | up to 5 | All current features | AGPLv3, free |
| **Enterprise** | unlimited | + LDAP, SSO, priority support | Commercial |

### License File

| Platform | Path |
|---|---|
| Windows | `C:\ProgramData\OxidVault\oxidvault.license` |
| Linux/macOS | `/etc/oxidvault/oxidvault.license` |

- File missing → Community Edition (no error, no crash)
- Invalid signature → Community Edition (silent fallback, log warning)
- Expired → Community Edition (silent fallback)
- Validation: Ed25519, fully offline

### License Signing

| Aspect | Detail |
|---|---|
| **Algorithm** | Ed25519 (asymmetric) |
| **Private key** | Developer local only — signs licenses |
| **Public key** | Build-time injection via `OXIDVAULT_PUBLIC_KEY` env var — embedded in binary, never in source |
| **Tamper-resistant** | Public key can only verify, not sign |
| **Open source safe** | No key material in repository — safe for AGPLv3 |
| **Key generation** | `cargo run -p license-generator -- generate-keypair` |
| **Fallback** | `OXIDVAULT_PUBLIC_KEY` not set → CE mode (no error) |

**JSON format (`oxidvault.license`):**

| Field | Description |
|---|---|
| `licensee` | Company name (display) |
| `plan` | `"community"` or `"enterprise"` |
| `max_users` | `0` = unlimited (EE), `5` = CE limit |
| `valid_until` | ISO date `YYYY-MM-DD` |
| `issued_at` | ISO date `YYYY-MM-DD` |
| `signature` | Ed25519 signature (base64) over all other fields (pipe-separated) |

### Feature Gates

| Feature | Community | Enterprise |
|---|---|---|
| Users per vault | max. 5 | unlimited |
| LDAP / AD | ❌ | ✅ (planned) |
| SSO SAML/OIDC | ❌ | ✅ (planned) |

> **Implementation:** `crates/vault-core/src/license.rs` · `AppState.license` (loaded at start) · `add_vault_user` → `license_limit_exceeded` · UI: `UserManagementPanel` / `AddUserModal`

---

*OxidVault — Built for admins who don't have time for slow tools.*
