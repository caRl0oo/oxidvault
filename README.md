# OxidVault

**Hochsicherer, on-premise Passwortmanager für Enterprise-Umgebungen.**

OxidVault richtet sich an Organisationen, die Zugangsdaten und Secrets **vollständig unter eigener Kontrolle** betreiben möchten — ohne Cloud-Abhängigkeit, ohne Fremd-Hosting und mit nachvollziehbaren Compliance-Pfaden. Die Anwendung kombiniert einen speichersicheren Rust-Kern mit einer schlanken Desktop-Oberfläche und ist für den Einsatz durch IT-Administratoren, Sicherheitsbeauftragte (CISO) und Endanwender in Firmenumgebungen konzipiert.

---

## Über OxidVault

OxidVault ist ein **Offline-First**-Tresor für Passwörter, SSH-Zugänge und weitere Secrets. Vault-Dateien (`.oxid`) können lokal oder auf **Netzlaufwerken (UNC-Pfade)** abgelegt werden — ideal für zentrale Team-Tresore in AD-Umgebungen.

| Prinzip | Bedeutung für Ihre Organisation |
|---|---|
| **On-Premise** | Keine Cloud-Synchronisation, keine Drittanbieter-Infrastruktur |
| **Zero-Knowledge** | Master-Passwort und Secret-Payloads verbleiben im Rust-Backend; Klartext gelangt nicht dauerhaft in die UI-Schicht |
| **Governance-ready** | Zentrale Richtlinien per Policy-Datei, auditierbare Ereignisse, Compliance-Dashboard |
| **Betriebssicher** | Atomare Schreibvorgänge, exklusives Datei-Locking, Key-Rotation ohne Payload-Re-Encrypt |

Ausführliche technische Spezifikationen: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Key Features

### Enterprise-Governance

Zentrale Steuerung über eine **Admin-Policy-Datei** im GPO-Stil. IT-Administratoren definieren verbindliche Vorgaben (z. B. Mindestlänge des Master-Passworts, Auto-Lock, Lock bei Minimieren), die Endanwender nicht überschreiben können.

| Plattform | Policy-Pfad |
|---|---|
| Windows | `C:\ProgramData\OxidVault\policy.json` |
| Linux / macOS | `/etc/oxidvault/policy.json` |

### Integrität & Compliance

**ISO-27001-konformes Audit-Logging** mit append-only Protokoll und **kryptografischer Hash-Kette**. Jeder Eintrag referenziert den vorherigen — Manipulationen sind erkennbar. Das Compliance-Dashboard prüft die Ketten-Integrität; der **Export** (JSON mit Integritätsheader oder CSV) unterstützt interne Audits und externe Prüfungen.

### Netzwerk-Resilienz

Spezielles Dateisystem-Handling für **UNC-Pfade und Netzwerklaufwerke**: Schreibvorgänge erfolgen über temporäre Dateien im selben Verzeichnis mit **`fsync`** und atomarem **`rename`**, inklusive SMB-Fallback. So bleiben Team-Vaults auf Fileservern auch bei parallelem Zugriff konsistent.

### Sicherheit per Design — Key-Rotation (Format v2)

Master-Passwort-Rotation über **sicheres Key-Wrapping**: Ein zufälliger Data-Encryption-Key (DEK) verschlüsselt den Payload; der DEK wird im Header mit dem passwort-abgeleiteten Key Encryption Key (KEK) geschützt. Bei einer Rotation wird **nur der Header neu geschützt** — der verschlüsselte Payload-Block wird 1:1 übernommen. **Kein Klartext der Secrets im RAM** während der Migration.

### Exklusiver Zugriff

Stabile **File-Locking-Mechanismen** (`{vault}.lock`) verhindern Race Conditions bei gleichzeitigem Öffnen. Stale Locks werden anhand von Prozess-Metadaten bereinigt; bei Konflikten meldet OxidVault, welcher Benutzer/Host den Tresor hält (`LockedBy`).

### Weitere Enterprise-Funktionen

- **Security Dashboard** — Offline-Schwachstellenanalyse (Duplikate, Entropie, Ablaufdaten)
- **Compliance-Dashboard** — Policy-, Audit- und Key-Age-Status mit Rotations-Empfehlung (> 90 Tage)
- **SSH Quick Connect** — Integriertes Terminal für gespeicherte SSH-Zugänge
- **Browser-Erweiterung** — Native Messaging für kontrollierte Autofill-Integration ([`browser-extension/README.md`](browser-extension/README.md))

---

## Compliance & Sicherheit

### Zero-Knowledge-Architektur

OxidVault folgt einem **Zero-Knowledge-Modell**:

- Das **Master-Passwort** wird ausschließlich zur Ableitung des Master-Keys (Argon2id) verwendet und nicht persistiert.
- **Secret-Payloads** werden mit AES-256-GCM verschlüsselt und verlassen den Rust-Kern standardmäßig nicht als Klartext über die IPC-Bridge.
- Sensible Puffer werden mit **`zeroize`** beim Sperren und Schließen aus dem Speicher entfernt.
- Explizite Freigabe (Reveal, Clipboard) ist bewusst eingeschränkt und auditierbar.

### Kryptografie (Auszug)

| Komponente | Verfahren |
|---|---|
| Key-Ableitung | Argon2id (OWASP-Empfehlung) |
| Verschlüsselung | AES-256-GCM |
| Zufallszahlen | OS CSPRNG (`getrandom`) |
| Passwort-Policy | Mindestlänge, Blocklist, zxcvbn-Entropie (UX + Backend) |

### Audit & Nachweisführung

| Funktion | Beschreibung |
|---|---|
| Audit-Log | `{vault}.audit.log` — Ereignisse wie `VaultCreated`, `VaultUnlocked`, `VaultKeyRotated` |
| Hash-Kette | SHA-256-Verkettung über alle Einträge |
| Export | JSON (mit Integritäts-Metadaten) oder CSV für Prüfer |
| Compliance-Status | IPC `get_compliance_status` — GPO-Flag, Ketten-Validität, Key-Age |

> **Hinweis:** OxidVault unterstützt Compliance-Prozesse technisch (Logging, Integritätsprüfung, Export). Die Einordnung in Ihr ISMS (z. B. ISO 27001) obliegt der jeweiligen Organisation.

---

## Erste Schritte

### Voraussetzungen

| Komponente | Version |
|---|---|
| Node.js | 20+ |
| Rust | stable (≥ 1.85, siehe `rust-toolchain.toml`) |
| Windows | WebView2 Runtime |
| Linux (Build) | `libwebkit2gtk-4.1-dev` und GTK-Abhängigkeiten ([Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)) |

### Entwicklung

```bash
git clone https://github.com/caRl0oo/oxidvault.git
cd oxidvault
npm install
npm run tauri:dev      # Desktop-App starten (Windows: scripts/tauri-dev.ps1)
```

### Release-Build (Windows)

```bash
npm install
npm run icons          # optional: Icons aus logo.png regenerieren
npm run tauri:build    # MSI/NSIS-Installer
```

Installer-Artefakte: `target/release/bundle/` (MSI, NSIS, portable EXE).

### Erster Vault

1. OxidVault starten und **neuen Tresor** anlegen (lokal oder UNC-Pfad).
2. **Master-Passwort** gemäß Policy wählen (Mindestlänge wird angezeigt).
3. Optional: Admin-Policy unter `C:\ProgramData\OxidVault\policy.json` bereitstellen.
4. Im Tab **Security** Compliance-Status und Passwort-Audit prüfen; bei Bedarf **Passwort rotieren**.

### Qualitätssicherung (CI)

Der Workflow [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) führt aus:

- `cargo audit` — Abhängigkeits-Scan
- `cargo fmt --check` / `cargo clippy`
- `cargo test` — Krypto- und Integrations-Tests

---

## Technologie

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
│               argon2 · aes-gcm · zeroize       │
└──────────────────────────────────────────────┘
```

| Schicht | Technologie | Rolle |
|---|---|---|
| **Backend / Krypto** | Rust (`vault-core`) | Verschlüsselung, Vault-Logik, Audit, Policy, Locking |
| **Desktop-Shell** | Tauri v2 | Native Runtime, IPC-Commands, OS-Integration |
| **Frontend** | React + TypeScript | Präsentationsschicht ohne Business-Logik |
| **Build** | Vite, Cargo | Optimierte Release-Binaries (`LTO`, `strip`) |

Diese Architektur trennt **Business Logic (Rust)** strikt von der **UI (React)** — Secrets und Schlüsselmaterial bleiben im speichersicheren Backend.

---

## Dokumentation & Lizenz

| Ressource | Inhalt |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Vollständige technische Referenz (IPC, Dateiformate, Sicherheit) |
| [`browser-extension/README.md`](browser-extension/README.md) | Browser-Integration via Native Messaging |

**Lizenz:** MIT OR Apache-2.0 (siehe Workspace-Metadaten in `Cargo.toml`).

---

*OxidVault — Built for admins who don't have time for slow tools.*
