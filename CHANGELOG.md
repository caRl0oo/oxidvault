# OxidVault Changelog

Release history for OxidVault. Architecture sync requirements remain in [ARCHITECTURE.md](ARCHITECTURE.md#14-documentation-requirements).

## 2.4.1 (2026-07-03)

### Fixed

- MSI native messaging registration was broken end-to-end; the Chrome Web Store extension could not connect on fresh installations. Four distinct bugs fixed:
  - `allowed_origins` contained a hardcoded stale extension ID — now rendered from a single source of truth (`browser-extension/chrome-store-extension.id`)
  - fragile inline PowerShell custom action replaced by a bundled `install-native-messaging-host.ps1` (writes manifest + HKCU keys for Chrome and Edge; uninstall removes both)
  - the WiX fragment was orphaned (Tauri links fragments only via `componentRefs`) — marker component added; actions now scheduled after `InstallFinalize` instead of mid-`InstallFiles`
  - a trailing backslash in the `[INSTALLDIR]` argument broke PowerShell argument parsing (MSI error 1722); the script now derives its path from `$PSScriptRoot`

### Developer

- `register_native_host.ps1` now writes both store and dev extension IDs — no re-registration needed when switching
- rendered WiX outputs are build artifacts (gitignored), generated from `.in` templates by `tauri-build.ps1`

## 2.4.0 (2026-06-25)

**BREAKING — File format v4:** AES-GCM AAD binds the multi-user plaintext header to the payload; downgrade guard (`format_version` in payload); v3→v4 on persist; `migrate_to_v3` writes v4; header mutations re-encrypt payload (MFA, user management).

**BREAKING — Extension autofill:** Gesture-gated autofill only; hostname authority from `sender.tab.url`; eTLD+1 matching via `psl` (no substring). Extension `0.5.0`.

- **Format v4:** `encrypt_with_aad` / `decrypt_with_aad`; header-bound payload integrity for multi-user vaults.
- **Audit HMAC checkpoints:** `derive_audit_hmac_key` (HKDF from DEK); `Checkpoint` log lines; `verify_audit_chain_keyed`; `auditChainAuthenticated` in compliance UI; v1 / pre-upgrade `audit_no_checkpoints`.
- **Extension anti-phishing:** `url_match` eTLD+1 via `psl` (no substring); gesture-gated autofill; `sender.tab.url` hostname authority.
- **NM bridge hardening:** `os_protect` session file ACL; token rotation on unlock; session file persists while locked for `vault_status` / `request_unlock`; locked-action allowlist at bridge dispatch; `get_login` rate limit + `SecretAutofilled` / `BridgeThrottled` audit.
- **Windows clipboard exclusion:** `SetExtWindows` history/cloud hints on secret copy + clear (`clipboard.rs`).
- **Backend zxcvbn:** master password entropy score ≥ 2 enforced in `policy/password.rs`; `WeakPasswordReason` for IPC/i18n; `migrate_to_v3` exempt (re-wrap).
- **Documentation:** changelog in `CHANGELOG.md`; admin deployment guide in `docs/ADMIN_DEPLOYMENT.md`; architecture version sync script; compliance legacy-format migration hint.

## Historical releases

| Date | Version | Change |
|---|---|---|
| 2025-06-19 | 0.1.0 | Initial project setup: Tauri v2, vault-core, React frontend, 4 Tauri commands, crypto specification |
| 2025-06-19 | 0.1.0 | Vault persistence: Argon2id + AES-256-GCM, `.oxid` format, 9 Tauri commands, secret CRUD, UI flow |
| 2025-06-19 | 0.1.0 | Vault setup flows: password → save dialog (create), file → password (open), German error messages |
| 2025-06-19 | 0.1.0 | Master password policy: min. 12 characters, blocklist, zxcvbn entropy (frontend + backend) |
| 2025-06-19 | 0.1.0 | Typed secrets: web_login, ssh_key, api_token — modal, sidebar icons, copy, AES-256-GCM persistence |
| 2025-06-19 | 0.1.0 | v0.1.0: clipboard auto-clear (30s), real-time search (title/URL/user), `username` in summary |
| 2025-06-19 | 0.1.0 | Password generator (CSPRNG, Ctrl+G), auto-lock (120s), RAM purge via zeroize |
| 2025-06-19 | 0.1.0 | Edit secret (`update_entry`), generator field apply in forms |
| 2025-06-19 | 0.1.0 | Theme system: Oxid, Dracula, Nord, Matrix — CSS variables + localStorage |
| 2025-06-19 | 0.1.0 | SSH quick connect: russh, xterm.js terminal, event streaming, key in RAM only |
| 2025-06-19 | 0.1.0 | Enterprise hardening: atomic writes (`.oxid.tmp`), lock-on-minimize |
| 2025-06-19 | 0.1.0 | Smart start: last vault path in `settings.json`, `bootstrap_vault`, `attach_locked`, "Open another vault" |
| 2025-06-19 | 0.1.0 | Web login quick open: `open_website_url`, http(s) validation, button in EntryDetail |
| 2025-06-19 | 0.1.0 | Web login: auto-`https://` for bare domains (google.de), scheme injection protection retained |
| 2025-06-19 | 0.1.0 | Admin secret types: database, network_wifi, secure_note · sidebar quick actions |
| 2025-06-19 | 0.1.0 | Live ping: TCP reachability, 10s polling, status dots sidebar + detail |
| 2025-06-19 | 0.1.0 | Folders & tags: `folder`/`tags` on secrets, sidebar filter, folder grouping |
| 2025-06-19 | 0.1.0 | Security dashboard: `audit_vault_security`, duplicate/weakness analysis, vault score |
| 2025-06-19 | 0.1.0 | Git sync: `sync_vault_git`, settings `gitSync`, header sync button, `Vault::reload_from_disk` |
| 2025-06-19 | 0.1.0 | Password expiry: `expires_at`, `ExpiryBadge`, security dashboard to-do list |
| 2025-06-19 | 0.1.0 | Dashboard tiles as sidebar filter: clickable metrics, `DashboardFilterBar` |
| 2025-06-19 | 1.0.0 | **Release:** Official branding (`logo.png`), Tauri icons, `AppLogo`, version 1.0.0, MSI build docs |
| 2025-06-19 | 1.0.0 | **Security hardening K1–K4:** `Zeroizing` in crypto/format, zero-clone `persist`, `SecretEntryPublic`, `reveal_secret`, `copy_to_clipboard` (arboard, 30s Rust clear), `Zeroizing<String>` for master password IPC |
| 2025-06-20 | 1.0.0 | **Git SSH passphrase UI:** settings field + `saveSshPassphrase` IPC; keyring INFO log on `set_password` |
| 2025-06-20 | 1.0.0 | **Git SSH keyring:** `ssh_keyring.rs` + `keyring` 3; `save_ssh_passphrase` / `remove_ssh_passphrase`; passphrase in OS store only |
| 2025-06-23 | 1.0.0 | **SSH host key TOFU:** `known_host_fingerprint` in `ssh_key` payload; `SshConnectResponse`; `ssh_trust_host` / `ssh_reject_host` |
| 2026-06-24 | 1.0.0 | **SSH known hosts (TOFU):** `known_host_fingerprint` in `SecretPayload`, `SshConnectResponse` with `Connected`/`UnknownHost`/`HostKeyMismatch`, `ssh_trust_host` / `ssh_reject_host` / `ssh_clear_host_fingerprint`, pending session cleanup on lock |
| 2026-06-25 | 1.0.0 | **Multi-user vault phase 1:** format v3 (`VaultUser[]` in plaintext header, shared DEK), `vault_user.rs`, `create_v3` / `unlock_as_user` / user management / `migrate_to_v3`, new audit events |
| 2026-06-25 | 2.0.0 | **Multi-user phase 2:** Tauri commands (`create_vault_v3`, `unlock_vault_as_user`, `add`/`remove_vault_user`, `change_user_password`, `migrate_vault_to_v3`), auth flow v3, `UserManagementPanel`, `MigrateToV3Modal`, i18n |
| 2026-06-25 | 2.0.0 | **Fix reload_from_disk v3:** DEK retained after Git sync pull; user list read from new header; lock guard before reload |
| 2026-06-25 | 2.0.0 | **Ed25519 license signing:** HMAC-SHA256 → Ed25519 asymmetric; public key via build-time env var injection; private key never in repo; open source safe |
| 2026-07-01 | 2.3.0 | **Password import:** client-side parsers (Bitwarden JSON, 1Password/KeePass/Chrome/RoboForm CSV); `ImportModal` + `ImportWelcomeModal`; Settings entry; `importOfferedPaths` + `mark_import_offered`; RoboForm `secure_note` detection; `scripts/verify-roboform-import.ts` |
| 2026-06-29 | 2.2.0 | **PDF via jsPDF:** printpdf + `patches/` fully removed; jsPDF + jspdf-autotable in frontend; offline, UTF-8, logo, colored actions, automatic page breaks |
| 2026-06-29 | 2.2.0 | **Auto-lock UI:** configurable timer (1/5/10/15/30 min/never); default 10 min; GPO-compatible |
| 2026-06-28 | 2.1.0 | **NM bridge tray-focus fix:** `minimized` incl. tray hide (`!is_visible`); `request_unlock` without vault mutex during focus; `perform_lock` mutex timeout 5s |
| 2026-06-28 | 2.1.0 | **System tray:** minimize to tray, vault stays unlocked, tray menu (open/lock/quit), `forceLockOnMinimize` GPO-compatible |
| 2026-06-25 | 2.0.0 | **Extension in-page banner removed:** `content.js` shows no lock/MFA banner; status only in popup; unlock polling remains for autofill |
| 2026-06-25 | 2.0.0 | **NM bridge focus-loop fix:** `vault_status.minimized`; `request_unlock` without focus when window minimized; `AppState.nm_bridge_focusing` suppresses lock-on-minimize during NM focus |
| 2026-06-25 | 2.0.0 | **License HMAC key:** external via `OXIDVAULT_LICENSE_KEY` / `license_hmac.key` — no longer in source (replaced by Ed25519) |
| 2026-06-25 | 2.0.0 | **License feature gate:** `license.rs` HMAC-SHA256 offline validation, CE 5-user limit, `get_license_info` command, upgrade banner in `UserManagementPanel` |
| 2026-06-25 | 2.0.0 | **MFA v3:** `session_kek` in vault RAM, enable/disable/verify per user entry (KEK-encrypted in header), `persist_v3_header` (no payload re-encrypt), unlock MFA check in `unlock_as_user`, routing in `enable_mfa`/`disable_mfa`/`verify_mfa_code`/`get_mfa_status` |
| 2026-06-25 | 1.0.0 | **MSI native messaging auto-setup:** WiX fragment `src-tauri/wix/native_messaging.wxs` registers host manifest + Chrome/Edge HKCU keys automatically on install (cleanup on uninstall) |
| 2025-06-23 | 1.0.0 | **Vault lock guard:** `commands/vault_guard.rs` — `ensure_vault_unlocked`; sensitive commands return `Err("Vault locked")` |
| 2025-06-23 | 1.0.0 | **SettingsView lock:** sync/security only when vault unlocked; `SettingsLockedView` with navigation to unlock |
| 2025-06-23 | 1.0.0 | **SettingsView:** fullscreen settings page with nav (general/sync/security); `SettingsMenu` dropdown removed |
| 2025-06-23 | 1.0.0 | **Git sync header:** `GitSyncStatusIndicator` in status cluster top right; lower status bar removed |
| 2025-06-23 | 1.0.0 | **Git sync status bar:** `GitSyncStatusBar` at window footer (full width); header sync icon removed; click opens Git settings |
| 2025-06-23 | 1.0.0 | **Git sync UI:** SSH key/passphrase in collapsed "Advanced" section; SSH secret passphrase clearly named; keyring service `oxidvault-git` (migration from `oxidvault`) |
| 2025-06-23 | 1.0.0 | **Git push:** enforce branch `main` (not `master`/HEAD), FF check before push, transfer progress logs, 120s timeout |
| 2025-06-23 | 1.0.0 | **Git sync scope:** status/commit only for `.oxid` file (no `add_all("*")`); default `.gitignore` on first init |
| 2025-06-23 | 1.0.0 | **Git SSH auth:** `remote_auth` tries `ssh-agent` first, then key file with keyring passphrase and explicit `.pub` path |
| 2025-06-20 | 1.0.0 | **Git sync git2:** in-process sync via `git2` 0.19; `RemoteCallbacks` (SSH key path, HTTPS basic); structured `GitSyncError` |
| 2025-06-20 | 1.0.0 | **Git sync module:** `src-tauri/src/git/git_sync.rs`; Tauri command `trigger_git_sync` (`spawn_blocking`, `GitSyncResult`) |
| 2025-06-20 | 1.0.0 | **SSH provider scaffold:** `ssh/provider/mod.rs` with trait `SshConnection`; `DEVELOPMENT_LOG.md` for refactoring backlog |
| 2025-06-20 | 1.0.0 | **Dependency audit:** `rsa` feature removed from `russh` (RUSTSEC-2023-0071); `.cargo/audit.toml` with allowlist for Linux GTK bindings (Tauri/wry) |
| 2025-06-19 | 1.0.0 | Dependency audit: `russh` 0.61 (`ring`), `rsa` removed from dependency tree |
| 2025-06-19 | 1.0.0 | **Native messaging phase 1:** CLI `--native-messaging` (headless), `native_messaging.rs` (stdio LE framing), dummy `ping`→`pong`, manifest `browser-extension/host/com.oxidvault.app.json` |
| 2025-06-19 | 1.0.0 | **Native messaging phase 2:** MV3 extension (`manifest.json`, `background.js`), `register_native_host.ps1` (Chrome/Edge registry), E2E guide in `browser-extension/README.md` |
| 2025-06-20 | 1.0.0 | **Native messaging Windows fix:** dedicated console binary `oxidvault-nmh.exe` (stdout pipe with Chrome/Edge), register script + extension timeout logging |
| 2025-06-20 | 1.0.0 | **Native messaging phase 3:** `content.js` login detection + autofill, `get_login` via NM→localhost IPC→vault, `url_match.rs`, `find_web_login_for_hostname` |
| 2025-06-20 | 1.0.0 | **ISO 27001 audit log:** `audit.rs` (append-only, hash chain), `AuditAction`/`AuditLogger`, vault integration; security dashboard → `security_audit.rs` |
| 2025-06-20 | 1.0.0 | **ISO 27001 OS protection:** `audit_secure.rs` — Windows DACL (user + administrators), Unix `0o600`, `audit::init()` startup check in `main.rs` |
| 2025-06-20 | 1.0.0 | **UNC + atomic writes:** `path_util.rs`, robust `atomic_write_vault` (temp in same share, rename + SMB copy fallback), docs §12 |
| 2025-06-20 | 1.0.0 | **Vault file lock:** `lock.rs` — exclusive `{vault}.lock`, stale repair via `sysinfo`, `LockedBy` error, `Vault::open`/`close`/`Drop` |
| 2025-06-20 | 1.0.0 | **Lock assertion:** `unlock` + smart start (`attach_locked`) with `assert_lock_valid`, `LockLost`, audit `VaultUnlocked` with lock ID |
| 2025-06-20 | 1.0.0 | **Admin GPO:** `policy/admin.rs`, `policy.json` (ProgramData/etc), `ResolvedConfig`, `get_resolved_config`, UI `disabled` flags |
| 2025-06-20 | 1.0.0 | **Audit log UI:** `get_audit_logs`, `read_audit_logs`/`AuditLogEntry`, tab **Activity**, `AuditLogTable.tsx` (search, local time, DE labels) |
| 2025-06-20 | 1.0.0 | **Dual-format audit export:** `audit_export.rs`, `export_audit_log`, hash chain validation, JSON integrity header, CSV export, UI save dialog |
| 2025-06-20 | 1.0.0 | **Enterprise v1.0:** format v2 (wrapped DEK), `reencrypt_vault`, `ComplianceDashboard`, `get_compliance_status`, `VaultKeyRotated` |
| 2025-06-20 | 1.0.0 | **Password rotation UI:** `RotationDialog.tsx`, policy validation, lock check (`LockedBy`), audit export verification |
| 2025-06-20 | 1.0.0 | **Compliance dashboard rotation:** primary button when key age >90 days, toast on success, compliance badge, v2 migration hint |
| 2025-06-20 | 1.0.0 | **Frontend i18n:** `i18next`/`react-i18next`, `src/locales/de.json` + `en.json`, language selection in `SettingsMenu`, security/compliance UI |
| 2025-06-20 | 1.0.0 | **Full-coverage i18n:** all UI components, `auditLogLabels.ts`, `errors.ts`, `vaultLabels.ts`, `passwordPolicy.ts`; `fallbackLng: false` |
| 2025-06-20 | 1.0.0 | **Admin system diagnostics:** `vault-core/diagnostics.rs`, `get_system_diagnostics`, security tab `SystemDiagnosticsPanel`, markdown clipboard export, i18n status codes |
| 2025-06-20 | 1.0.0 | **Theme refresh:** Matrix removed; new **Oxid Light** (enterprise light mode); semantic tokens `vault-on-accent`, `vault-overlay`, `vault-elevated-shadow` |
| 2025-06-20 | 1.0.0 | **2FA (TOTP) — UI + placeholder API:** `vault-core/mfa.rs`, `enable_mfa` / `verify_mfa_code`, settings submenu "Two-factor authentication", `MfaSetupModal` with QR placeholder and code input |
| 2025-06-20 | 1.0.0 | **2FA (TOTP) — full implementation:** `totp-rs` + `qrcode`, CSPRNG secret, QR PNG, AES-256-GCM persistence in vault payload, offline RFC 6238 verification (`bool`) |
| 2025-06-20 | 1.0.0 | **2FA settings UI:** `get_mfa_status` / `disable_mfa`, dynamic button in `SettingsMenu`, status badge, deactivation confirmation, live update after verification |
| 2025-06-20 | 1.0.0 | **2FA-gated unlock:** `PendingUnlock` in `vault-core`, two-step `open_vault`/`unlock_vault` → `UnlockVaultResponse`, `complete_unlock_vault` / `cancel_pending_unlock`, dynamic MFA field in `AuthForm` |
| 2025-06-20 | 1.0.0 | **Atomic auth flow:** `vault-core/auth.rs` — `unlock_vault(password, mfa_code)` → `VaultHandle` / `AuthError`; no `PendingUnlock`; IPC `mfa_code?` on `open_vault`/`unlock_vault`; frontend sends password+MFA atomically |
| 2025-06-20 | 1.0.0 | **Browser extension MFA (phase 4):** `mfa_required`/`mfa_failed`/`success` in NM protocol, `vault_status` + `request_unlock`, popup + in-page banner, `settings.vaultMfaConfigured`, no MFA input in extension |
| 2025-06-20 | 1.0.0 | **Browser extension WASM generator (phase 5):** `vault-generator`/`vault-wasm`, popup generator with desktop themes, `open_new_secret` → `NewSecretModal` prefill |
| 2025-06-20 | 1.0.0 | **Secret hard delete:** `Vault::delete_entry`/`delete_secret`, zeroizing before removal, `delete_entry` IPC, `DeleteConfirmationModal`, Git sync after delete, audit `EntryDeleted` |
| 2026-06-20 | 1.0.0 | **UI header & sidebar nav:** command bar without double branding, sidebar `w-80`, tab nav with lucide icons (FolderLock/Shield/Activity), full label view without ellipsis |
| 2026-06-20 | 1.0.0 | **Audit log extension:** `SecretCreated`/`SecretModified`, `AuthFailed`, `SyncEvent`, `ConfigChanged`; UUID-only secret references; activity UI with icons/color codes |
| 2026-06-20 | 1.0.0 | **Enterprise MSI browser extension:** fixed extension ID (RSA/CRX), force-install policy (Chrome/Edge), WiX custom action, `installer/README.md` |
| 2026-06-22 | 1.0.0 | **Admin deployment guide:** section 16, `docs/policy.json.example`, README enterprise & compliance |
| 2026-06-22 | 1.0.0 | **Backend idle lock:** `state.rs`, `idle_worker.rs`, `touch_activity` IPC, `vault-idle-warning`, frontend warning banner |
| 2026-06-20 | 1.0.0 | **SSH command-await:** `ssh_connect` async with 15s timeout, PTY/shell `want_reply`, errors via `Result` to frontend; I/O loop still via event |
| 2026-06-20 | 1.0.0 | **SSH key loader:** `key_loader.rs`, vault-only keys, PEM validation, format-specific russh parsing, backend logging; test keys removed |
| 2026-06-20 | 1.0.0 | **SSH terminal streaming:** output backlog + `ssh_begin_streaming`, `ssh_resize_pty`, listener race fixed |
| 2026-06-20 | 1.0.0 | **SSH terminal layout:** pixel split + ResizeObserver init, focus mode, `ssh_connect(cols, rows)` for initial PTY size |
