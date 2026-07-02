# OxidVault — Development Log

Zentrale Sammelstelle für architektonische Ideen und geplante Refactorings.
Diese Datei ergänzt [`ARCHITECTURE.md`](ARCHITECTURE.md) (Implementierungsstand) mit
Backlog, Experimenten und langfristigen Strukturentscheidungen.

---

### Refactoring-Plan: SSH-Abstraktion (SshProvider-Trait)

**Ziel:** Entkopplung der SSH-Logik von `russh`, um in Zukunft flexibel auf andere
Bibliotheken (z.B. ssh2-rs oder ssh-rs) wechseln zu können.

**Status (Scaffold → Phase 1):**

| Schritt | Status |
|---------|--------|
| Trait `SshConnection` in `src-tauri/src/ssh/provider/mod.rs` | ✅ |
| `RusshProvider` implementiert `SshConnection` (`provider/russh_provider.rs`) | ✅ |
| `SshManager` delegiert an `RusshProvider` | ✅ |
| Weitere Backends (`ssh2`, …) | 🔲 Geplant |
| Integrationstests pro Backend | 🔲 Geplant |

**Geplante Methoden (Trait):** `connect`, `send_data`, `resize_pty`, `disconnect`

**Offene Punkte:**

- Event-Streaming (`ssh-data`, `ssh-closed`) — Callback vs. async Stream im Trait
- Host-Key-Verification — aktuell `check_server_key → Ok(true)`; Policy später
- Session-Multiplexing — ein Provider pro Session vs. Manager hält Registry

---

### Feature-Ideen (OxidVault)

_(Backlog — Ideen hier sammeln, priorisieren, dann in Issues/ARCHITECTURE überführen.)_

- SFTP-Datei-Browser für SSH-Einträge
- Mehrere gleichzeitige SSH-Sessions pro Vault-Eintrag (Tabs)
- SSH-Known-Hosts-Pinning mit Vault-gespeicherten Fingerprints
- Jump-Host / ProxyCommand für interne Netzwerke
- **CI: add a `windows-latest` job** to the GitHub Actions workflow (`cargo clippy
  --all-targets -- -D warnings` + `cargo test -p vault-core`). All Windows-specific
  security code (`os_protect` DACLs, `audit_secure`, clipboard history exclusion) is
  currently neither compiled nor linted nor tested in CI — the Linux runner only builds
  the unix branches. Discovered via unused-variable clippy failure in `os_protect.rs`
  that was invisible locally on Windows.

---

### Sicherheit & Audit-ToDos

_(Sicherheits-relevante Verbesserungen außerhalb des laufenden Sprints.)_

- **quick-xml (`RUSTSEC-2026-0194` / `RUSTSEC-2026-0195`):** Ausnahme in
  [`.cargo/audit.toml`](.cargo/audit.toml) entfernen, sobald `tauri-utils` **> 2.9.3**
  mit `quick-xml` **≥ 0.41** verfügbar ist (transitiv über plist/Bundler-Config).
  Vor jedem Release: `cargo update && cargo audit` **ohne** Ignore-Einträge prüfen —
  nur die verbleibenden, dokumentierten GTK-/unic-/git2-Ausnahmen dürfen bestehen bleiben.
- Host-Key-Trust-Modell definieren (TOFU, Vault-Fingerprint, Admin-GPO)
- `cargo audit`: verbleibende `unic-*`-Warnungen triagieren
- Pen-Test-Checkliste für SSH Quick Connect (Timeout, Lock → disconnect_all)
- Dokumentation: welche Key-Typen produktiv unterstützt sind (Ed25519 primär)
