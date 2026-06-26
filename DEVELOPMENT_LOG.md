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

---

### Sicherheit & Audit-ToDos

_(Sicherheits-relevante Verbesserungen außerhalb des laufenden Sprints.)_

- Host-Key-Trust-Modell definieren (TOFU, Vault-Fingerprint, Admin-GPO)
- `cargo audit`: verbleibende `unic-*`-Warnungen triagieren
- Pen-Test-Checkliste für SSH Quick Connect (Timeout, Lock → disconnect_all)
- Dokumentation: welche Key-Typen produktiv unterstützt sind (Ed25519 primär)
