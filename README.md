# OxidVault

![Rust](https://img.shields.io/badge/Rust-1.85%2B-orange?logo=rust&logoColor=white) ![License](https://img.shields.io/badge/License-AGPL--3.0-blue) ![Status](https://img.shields.io/badge/Status-Beta-green) ![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey) ![Website](https://img.shields.io/badge/Website-oxidvault.com-purple)

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
| **MFA-geschützt** | TOTP (RFC 6238) als zweite Faktor-Hürde; atomare Entsperrung ohne Zwischenzustände im RAM |
| **Multi-User** | Pro Vault bis zu 5 Benutzer (CE) — jeder mit eigenem Passwort und MFA; shared DEK-Architektur |
| **Kommerzielle Lizenz** | Enterprise Edition für unbegrenzte User, LDAP, SSO — [oxidvault.com](https://oxidvault.com) |

Ausführliche technische Spezifikationen: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Sicherheit & Architektur

OxidVault ist als **speichersicherer, offline-fähiger Tresor** konzipiert. Sicherheitsentscheidungen werden im Rust-Kern (`vault-core`) durchgesetzt — die React-Oberfläche ist reine Präsentationsschicht ohne Zugriff auf Schlüsselmaterial.

### Offline-First & lokale Souveränität

- **Keine Cloud-Abhängigkeit** — Vault-Dateien (`.oxid`) verbleiben vollständig unter Ihrer Kontrolle (lokal, UNC-Pfad, optional Git-Sync der *verschlüsselten* Datei).
- **Kein Fremd-Hosting** — Secrets werden nicht an Drittanbieter übertragen; Autofill-Integrationen (Browser-Erweiterung) nutzen kontrollierte Native-Messaging-Kanäle.
- **On-Premise by Design** — geeignet für AD-Umgebungen, isolierte Netzwerke und regulierte Branchen.

### Zwei-Faktor-Authentifizierung (TOTP / MFA)

- **RFC 6238** — zeitbasierte Einmalpasswörter (TOTP) vollständig **offline** validierbar; kein SMS-Gateway, kein OAuth-Provider.
- **Enrollment in den Einstellungen** — CSPRNG-Secret, QR-Code (otpauth-URI), verschlüsselte Persistenz im Vault-Payload (AES-256-GCM).
- **Entsperr-Flow** — nach korrektem Master-Passwort erscheint die MFA-Challenge; Auto-Fokus, Auto-Submit und **UI-seitiges Rate-Limiting** (3 Fehlversuche → 30 s Sperre) erschweren Brute-Force-Versuche am Desktop.

### Multi-User Vaults (Format v3)

OxidVault unterstützt gemeinsam genutzte Tresore mit mehreren Benutzern — ohne zentralen Server.

- **Eigenes Passwort pro User** — kein geteiltes Master-Passwort
- **Eigenes TOTP pro User** — MFA ist personengebunden, nicht vault-gebunden
- **Shared DEK-Architektur** — ein gemeinsamer Data-Encryption-Key, pro User mit dessen KEK gewrappt; Passwort-Rotation eines Users berührt andere User nicht
- **Rollen** — `Admin` (User verwalten) und `Member` (Secrets lesen/schreiben)
- **Migration** — bestehende v1/v2-Tresore per Einmalvorgang auf v3 migrierbar; das bisherige Master-Passwort wird zum ersten Admin-User

Community Edition: bis zu **5 Benutzer** pro Vault.  
Enterprise Edition: unbegrenzte Benutzer — [oxidvault.com](https://oxidvault.com)

### Atomare Entsperrung

Der Tresor kann **technisch nicht** nur mit dem Master-Passwort geöffnet werden, wenn MFA aktiv ist:

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

- Zentrale Funktion: `vault-core/src/auth.rs` → `unlock_vault(password, mfa_code)` → `VaultHandle` | `AuthError`
- **Kein `PendingUnlock`** — bei `MfaRequired`, `InvalidPassword` oder `InvalidMfa` wird **nichts** an der live `Vault`-Session committet.
- Entschlüsselte Daten existieren während der Prüfung nur in **ephemerem Stack-Speicher** und werden bei Abbruch explizit zeroized.

### Zero-Knowledge & Speicherschutz

| Aspekt | Umsetzung |
|---|---|
| Master-Passwort | Nur zur KEK-Ableitung; `Zeroizing<String>` an IPC-Grenzen |
| MFA-Codes | `Zeroizing<String>`; keine Persistenz |
| Gesperrter Vault | `master_key`, `kek`, Einträge und Klartext-Secrets werden aus dem RAM entfernt |
| Lock / Close | `zeroize` auf allen kryptografischen Puffern und Secret-Feldern |
| IPC | Keine dauerhafte Klartext-Übertragung — Metadaten via `SecretEntryPublic`; Reveal/Clipboard bewusst einmalig |

> Selbst im gesperrten Zustand verbleiben **keine entschlüsselten Secrets** in der aktiven Vault-Session.

### Enterprise-Oberfläche & Betrieb

- **Modulares Theme-System** — Oxid Default, Oxid Light, Dracula, Nord u. a.; semantische Design-Tokens (`vault-accent`, `vault-danger`, …) für konsistente Darstellung in hellen, dunklen und High-Contrast-Umgebungen.
- **Admin-Policy (GPO-Stil)** — zentrale Vorgaben für Passwortlänge, Auto-Lock, UI-Sperren.
- **Audit & Compliance** — append-only Audit-Log mit Hash-Kette, Export für Prüfer, Compliance-Dashboard.

### Relevante Module (Auszug)

| Modul / Komponente | Verantwortung |
|---|---|
| `crates/vault-core/src/auth.rs` | Atomare Authentifizierung (`AuthError`, `VaultHandle`, `unlock_vault`) |
| `crates/vault-core/src/mfa.rs` | TOTP-Enrollment, Verifikation (RFC 6238), verschlüsselte MFA-Secret-Speicherung |
| `crates/vault-core/src/crypto.rs` | Argon2id, AES-256-GCM, `MasterKey`, Zeroizing |
| `src/hooks/useMfaRateLimit.ts` | UI-Rate-Limiting für MFA-Fehlversuche (Lockout + Countdown) |
| `src/components/screens/AuthForm.tsx` | Entsperr-Modal mit dynamischer MFA-Challenge |
| `src-tauri/src/commands/` | IPC-Bridge; `Zeroizing` für Passwörter und MFA-Codes |

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

- **Zwei-Faktor-Authentifizierung (TOTP)** — MFA-Enrollment, atomare Entsperrung, UI-Rate-Limiting
- **Multi-User Vaults (v3)** — bis 5 User CE, unbegrenzt EE; pro User Passwort + MFA
- **Ed25519 Lizenz-Validierung** — offline, fälschungssicher, kein Lizenzserver nötig
- **SSH Known-Hosts Verifikation** — TOFU + gespeicherter Fingerprint; MITM-Warnung bei Abweichung
- **reveal_secret Rate-Limiting** — Sliding Window (5 Anfragen / 60s) gegen Bulk-Extraktion
- **Security Dashboard** — Offline-Schwachstellenanalyse (Duplikate, Entropie, Ablaufdaten)
- **Compliance-Dashboard** — Policy-, Audit- und Key-Age-Status mit Rotations-Empfehlung (> 90 Tage)
- **SSH Quick Connect** — Integriertes Terminal für gespeicherte SSH-Zugänge
- **Browser-Erweiterung** — Native Messaging für kontrolliertes Autofill ([Chrome Web Store](https://chromewebstore.google.com/detail/oxidvault/belagnpfebgljfamjihdoinbcehingjd) · [`browser-extension/README.md`](browser-extension/README.md))

---

## Compliance & Sicherheit

> Ausführliche Architektur- und MFA-Spezifikation: Abschnitt [Sicherheit & Architektur](#sicherheit--architektur) und [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Zero-Knowledge-Architektur

OxidVault folgt einem **Zero-Knowledge-Modell**:

- Das **Master-Passwort** wird ausschließlich zur Ableitung des Master-Keys (Argon2id) verwendet und nicht persistiert.
- **Secret-Payloads** werden mit AES-256-GCM verschlüsselt und verlassen den Rust-Kern standardmäßig nicht als Klartext über die IPC-Bridge.
- **MFA-TOTP-Secrets** liegen verschlüsselt im Vault-Payload; Validierung erfolgt offline im Backend.
- Sensible Puffer werden mit **`zeroize`** beim Sperren, bei Auth-Fehlern und Schließen aus dem Speicher entfernt.
- Explizite Freigabe (Reveal, Clipboard) ist bewusst eingeschränkt und auditierbar.

### Kryptografie (Auszug)

| Komponente | Verfahren |
|---|---|
| Key-Ableitung | Argon2id (OWASP-Empfehlung) |
| Verschlüsselung | AES-256-GCM |
| Zweiter Faktor | TOTP / RFC 6238 (SHA-1, 6 Stellen, 30 s Fenster) |
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
3. Optional: **Zwei-Faktor-Authentifizierung** unter Einstellungen aktivieren (Authenticator-App).
4. Optional: Admin-Policy unter `C:\ProgramData\OxidVault\policy.json` bereitstellen.
5. Im Tab **Security** Compliance-Status und Passwort-Audit prüfen; bei Bedarf **Passwort rotieren**.

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
│               auth · mfa · argon2 · aes-gcm  │
│               zeroize · totp-rs              │
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

## Community & Enterprise Edition

| Feature | Community (CE) | Enterprise (EE) |
|---|---|---|
| Alle aktuellen Features | ✅ | ✅ |
| Bis 5 User pro Vault | ✅ | ✅ |
| Unbegrenzte User | ❌ | ✅ |
| LDAP / Active Directory | ❌ | ✅ |
| SSO (SAML / OIDC) | ❌ | ✅ |
| Priority Support + SLA | ❌ | ✅ |
| Lizenz | AGPLv3 (Open Source) | Kommerziell |
| Preis | Kostenlos | Auf Anfrage |

→ **[oxidvault.com](https://oxidvault.com)** · [support@oxidvault.com](mailto:support@oxidvault.com)

## Download

→ **[Neueste Version auf GitHub Releases](https://github.com/caRl0oo/oxidvault/releases/latest)**

| Plattform | Datei |
|---|---|
| **Windows** | `OxidVault_2.0.1_x64_en-US.msi` |

> **Hinweis:** Nach der Installation die Lizenzdatei für Enterprise unter `C:\ProgramData\OxidVault\oxidvault.license` ablegen — Details: [oxidvault.com](https://oxidvault.com)

---

## Changelog

### [2.0.0] — Multi-User & Security

#### Multi-User Architektur

- **Format v3** — shared DEK, pro-User KEK-Wrapping, User-Tabelle im Plaintext-Header
- **Multi-User Login** — Username-Textfeld (kein Dropdown, kein Username-Enumeration-Risiko)
- **Benutzerverwaltung** — Admin kann User hinzufügen/entfernen, Rollen ändern
- **Passwort ändern** — jeder User kann sein eigenes Passwort ohne Vault-Re-Encrypt rotieren
- **MFA pro User** — TOTP in User-Eintrag (KEK-verschlüsselt), nicht im Vault-Payload
- **Migration v1/v2 → v3** — einmaliger Vorgang in den Einstellungen

#### Sicherheit

- **SSH Known-Hosts** — TOFU + gespeicherter SHA-256-Fingerprint; MITM-Warnung bei Abweichung
- **reveal_secret Rate-Limiting** — Sliding Window (5/60s), Reset bei Lock, Audit-Event
- **reload_from_disk v3** — DEK bleibt nach Git-Sync-Pull erhalten; kein stiller Session-Verlust
- **Ed25519 Lizenz-Signierung** — asymmetrisch; Public Key in Binary eingebettet; Private Key nie im Repo; Open Source safe
- **UI Overhaul** — Raycast-inspiriertes Oxid Light Theme als Standard; vault-card, vault-input, vault-btn-* Design-Tokens

### [1.0.0] — Enterprise Release

#### Sicherheit & Authentifizierung

- **TOTP-MFA (RFC 6238)** — Enrollment mit QR-Code, verschlüsselte Secret-Speicherung im Vault-Payload, Settings-UI (`MfaSetupModal`, `get_mfa_status`, `disable_mfa`).
- **Atomare Entsperrung** — neues Modul `vault-core/src/auth.rs` mit `unlock_vault(password, mfa_code) → VaultHandle | AuthError`; kein teilentschlüsselter Vault-Zustand im RAM; Entfernung von `PendingUnlock` / zweistufigem Pending-Unlock.
- **IPC** — `open_vault` / `unlock_vault` akzeptieren optionales `mfa_code`; einheitlicher `UnlockVaultResponse`-Flow.
- **Entsperr-UX** — dynamisches MFA-Feld im `AuthForm`, Auto-Fokus, Auto-Submit bei 6 Ziffern.
- **UI-Rate-Limiting** — `useMfaRateLimit`: nach 3 ungültigen MFA-Codes 30 s Lockout mit Countdown (`vault-danger`-Theme-Tokens).

#### Dokumentation

- `ARCHITECTURE.md` — Datenfluss atomare Entsperrung, `AuthError`, `UnlockVaultResponse`, Changelog-Einträge.

---

## Dokumentation & Lizenz

| Ressource | Inhalt |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Vollständige technische Referenz (IPC, Dateiformate, Sicherheit) |
| [`browser-extension/README.md`](browser-extension/README.md) | Browser-Integration via Native Messaging |
| [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md) | Kommerzielle Lizenz ohne AGPLv3-Pflichten |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Beiträge, CLA, Security-Reporting |

### Lizenzierung

OxidVault steht unter der **[GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html)**. Die AGPL-3.0 verpflichtet jeden, der die Software (oder davon abgeleitete Werke) weiterverbreitet oder als Netzwerkdienst bereitstellt, den **vollständigen Quellcode** unter derselben Lizenz zugänglich zu machen. Für Enterprise-Umgebungen bedeutet das: Änderungen am Tresor-Kern, an der Kryptografie oder an sicherheitsrelevanten Komponenten bleiben nachvollziehbar und können nicht ohne Quellenoffenlegung als proprietäre Blackbox weitergegeben werden — ein zentraler Baustein für **Transparenz, Prüfbarkeit und langfristige Sicherheit**.

Für kommerzielle Nutzung ohne AGPLv3-Pflichten steht eine **Enterprise-Lizenz** zur Verfügung.  
Details: [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) · [support@oxidvault.com](mailto:support@oxidvault.com)

---

## Sicherheit & Responsible Disclosure

Wenn Sie eine Sicherheitslücke in OxidVault entdecken, melden Sie diese bitte **vertraulich** — nicht über öffentliche Issues oder Pull Requests.

| Kanal | Adresse |
|---|---|
| **Security Contact** | [security@oxidvault.com](mailto:security@oxidvault.com) |

Bitte beschreiben Sie betroffene Version, Plattform, Reproduktionsschritte und — falls möglich — einen Proof of Concept. Wir bestätigen den Eingang in der Regel innerhalb von **72 Stunden** und koordinieren mit Ihnen einen verantwortungsvollen Disclosure-Zeitplan, bevor Details veröffentlicht werden.

> **Hinweis:** Meldungen an `security@oxidvault.com` sind ausschließlich für Sicherheitsvorfälle gedacht. Für allgemeine Support- oder Feature-Anfragen nutzen Sie bitte die Projekt-Issues auf GitHub.

---

## Enterprise & Compliance

OxidVault unterstützt **Enterprise-Policies** über eine maschinenweite `policy.json` (Auto-Lock, Mindestpasswortlänge, Git-Sync, Lock-on-Minimize). IT-Teams können Vorgaben zentral per GPO oder Intune ausrollen, ohne dass End-User diese Einstellungen überschreiben können.

| Ressource | Inhalt |
|---|---|
| [Admin-Deployment Guide](ARCHITECTURE.md#16-admin-deployment-guide) | GPO-Rollout in ~5 Minuten, Pfade, Fail-Safe-Logik, Verifikation |
| [`docs/policy.json.example`](docs/policy.json.example) | Vorlage mit allen unterstützten Policy-Feldern |

---

*OxidVault — Built for admins who don't have time for slow tools.*
