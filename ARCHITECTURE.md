# OxidVault — Technische Architektur

> **Single Source of Truth**  
> Dieses Dokument ist die zentrale Referenz für die technische Architektur von OxidVault.  
> Bei jeder Ergänzung von Kernfunktionen, Tauri Commands, Dateiformaten oder sicherheitsrelevanten Änderungen ist **ARCHITECTURE.md** synchron mit dem Code zu aktualisieren.

**Version:** 1.0.0 · **Stand:** 2025-06-19

---

## Inhaltsverzeichnis

1. [Projekt-Übersicht](#1-projekt-übersicht)
2. [Tech-Stack](#2-tech-stack)
3. [Security- & Krypto-Spezifikationen](#3-security--krypto-spezifikationen)
4. [Verzeichnisstruktur](#4-verzeichnisstruktur)
5. [Systemarchitektur](#5-systemarchitektur)
6. [API-Schnittstellen (Tauri Commands)](#6-api-schnittstellen-tauri-commands)
7. [Dateiformate](#7-dateiformate)
8. [Frontend-Architektur](#8-frontend-architektur)
9. [Build, Deployment & Betrieb](#9-build-deployment--betrieb)
10. [Dokumentationspflicht & Changelog](#10-dokumentationspflicht--changelog)

---

## 1. Projekt-Übersicht

### Name

**OxidVault** — ein ultraschneller, minimalistisch designter B2B-Passwort- und Secret-Manager.

### Zielgruppe

| Persona | Anforderungen |
|---|---|
| **IT-Administratoren** | Zentrale Verwaltung von Zugangsdaten, schnelle Rotation, klare Audit-Pfade |
| **DevOps Engineers** | CLI/API-freundliche Workflows, Self-Hosted-Betrieb, Integration in Pipelines |
| **Power-User** | Tastatur-first Bedienung, minimale UI-Latenz, volle Offline-Kontrolle |

### Kernphilosophie

| Prinzip | Beschreibung |
|---|---|
| **Offline-First** | Keine Cloud-Abhängigkeit. Der Vault läuft vollständig lokal bzw. self-hosted. Netzwerkzugriff ist optional, niemals vorausgesetzt. |
| **Ultraschnell** | Speichersicherer Rust-Kern, schlanke UI, optimierte Release-Profile (`LTO`, `opt-level = "z"`). Latenz-kritische Pfade verbleiben im Backend. |
| **Tastaturoptimiert** | Alle Kernaktionen per Shortcut erreichbar. Mausbedienung ist Ergänzung, nicht Voraussetzung. |
| **Zero-Knowledge** | Der Master-Key verlässt den Rust-Kern nie im Klartext. Das Frontend sieht nur explizit freigegebene, entschlüsselte Daten — und nur solange der Vault entsperrt ist. |
| **Minimalismus** | Keine Feature-Bloat. Jede Komponente hat eine klar abgegrenzte Verantwortung. |

---

## 2. Tech-Stack

### Überblick

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
│  vault-core · argon2 · aes-gcm · zeroize · serde          │
└─────────────────────────────────────────────────────────┘
```

### Frontend

| Technologie | Version | Rolle |
|---|---|---|
| **React** | 19.x | UI-Komponenten, State-Management |
| **TypeScript** | 5.8.x | Typsicherheit, IPC-Contracts |
| **Tailwind CSS** | 4.x | Utility-first Styling, Dark-Theme |
| **Vite** | 6.x | Dev-Server (Port `1420`), Production-Bundling |

### Desktop-Shell & Backend

| Technologie | Version | Rolle |
|---|---|---|
| **Tauri** | 2.x | Native Desktop-Runtime, WebView, IPC |
| **Rust** | stable (≥ 1.77) | Speichersichere Backend-Logik |
| **tauri-plugin-shell** | 2.x | Kontrollierter System-Shell-Zugriff |

### Rust Workspace

| Crate | Pfad | Verantwortung |
|---|---|---|
| `vault-core` | `crates/vault-core/` | Kryptografie, Vault-Logik, Dateiformat |
| `oxidvault` | `src-tauri/` | Tauri-Integration, Commands, App-State |

### Werkzeuge

| Tool | Zweck |
|---|---|
| `rust-toolchain.toml` | Pinning auf Stable Rust + `rustfmt` / `clippy` |
| `@tauri-apps/cli` | Dev-Build, Bundling, Icon-Generierung |
| `scripts/generate-icons.mjs` | Legacy-Fallback-Icons (ersetzt durch `npm run icons`) |

---

## 3. Security- & Krypto-Spezifikationen

### Zero-Knowledge-Architektur

OxidVault folgt einem **Zero-Knowledge-Modell**: Der Server bzw. die Desktop-Runtime kennt zu keinem Zeitpunkt das Master-Passwort oder den abgeleiteten Master-Key in unverschlüsselter Form außerhalb des geschützten Speicherbereichs im Rust-Kern.

```
Master-Passwort
      │
      ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Argon2id   │────▶│   Master Key     │────▶│  AES-256-GCM    │
│  (KDF)      │     │  (32 Byte, RAM)  │     │  Daten-Vault    │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                       │                        │
      │ Salt (pro Vault)      │ zeroize on lock         │ Nonce (pro Blob)
      ▼                       ▼                        ▼
  .oxid Header            Nie ans Frontend         Verschlüsselte Datei
```

**Garantien:**

- Das Master-Passwort wird **nicht** persistiert, geloggt oder an das Frontend übergeben.
- Der Master-Key wird bei `lock_vault` via `zeroize` aus dem Speicher entfernt.
- Das Frontend kommuniziert ausschließlich über typisierte Tauri Commands — kein direkter Datei- oder Krypto-Zugriff.
- CSP in `tauri.conf.json` beschränkt Script- und Style-Quellen auf `'self'`.

### Schlüsselableitung (KDF): Argon2id

| Parameter | Wert | Begründung |
|---|---|---|
| **Algorithmus** | Argon2id | Hybrid gegen Side-Channel- und GPU-Angriffe |
| **Output-Länge** | 32 Byte (256 Bit) | Kompatibel mit AES-256 |
| **Salt** | 16 Byte, kryptografisch zufällig | Pro Vault eindeutig, im Header gespeichert |
| **Memory (m)** | 64 MiB | B2B-tauglicher Brute-Force-Schutz |
| **Iterations (t)** | 3 | OWASP-Empfehlung für Argon2id |
| **Parallelism (p)** | 4 | Ausgewogen für Desktop-Hardware |

**Implementierungsstatus:** ✅ Implementiert in `crates/vault-core/src/crypto.rs` (`MasterKey::derive_from_password`).

### Master-Passwort-Richtlinie (Password Policy)

> Gilt **ausschließlich beim Anlegen** eines neuen Vaults (`create_vault`). Beim Öffnen bestehender Vaults wird die ursprüngliche Passwortlänge respektiert.

| Regel | Wert | Durchsetzung |
|---|---|---|
| **Mindestlänge** | 12 Zeichen | Frontend (Submit-Button) + Backend (`policy.rs`) |
| **Blocklist** | ~45 häufige Passwörter (`password`, `admin123`, `12345678`, …) | Frontend + Backend (exakter Match, case-insensitive) |
| **Entropie-Check** | zxcvbn Score ≥ 2 (0–4 Skala) | Frontend (`@zxcvbn-ts/core`) — Echtzeit-Feedback |

**UX-Feedback (Frontend):**

- Passwortfeld: Rot = Richtlinie verletzt, Grün = erfüllt
- Fortschrittsbalken + Label (Sehr schwach → Sehr stark)
- Checkliste: Länge · Blocklist · Entropie
- Submit deaktiviert bis alle Kriterien erfüllt

**Backend-Modul:** `crates/vault-core/src/policy.rs` · Fehler: `VaultError::WeakPassword`

**Hinweis:** zxcvbn läuft clientseitig für UX; das Backend erzwingt Länge + Blocklist als autoritative Mindestschwelle.

### Symmetrische Verschlüsselung: AES-256-GCM

| Parameter | Wert |
|---|---|
| **Algorithmus** | AES-256-GCM (AEAD) |
| **Schlüssel** | Abgeleiteter 256-Bit-Master-Key |
| **Nonce / IV** | 12 Byte, pro verschlüsseltem Blob einmalig (nie wiederverwenden) |
| **Auth-Tag** | 128 Bit (Standard GCM) |
| **AAD** | Optional: Vault-ID + Entry-ID als zusätzlich authentifizierte Metadaten |

**Einsatzbereiche:**

- Vault-Datei-Body (Secret-Einträge, Notizen, Anhänge)
- Export-Bundles (optional passwortgeschützt mit separatem Ephemeral-Key)

**Implementierungsstatus:** ✅ Implementiert in `crates/vault-core/src/crypto.rs` (`encrypt` / `decrypt`). Falsches Passwort führt zu GCM-Auth-Fehler → `VaultError::InvalidPassword`.

### Speichersicherheit

| Maßnahme | Crate / Mechanismus |
|---|---|
| Schlüssel-Löschung bei Lock | `zeroize` + `ZeroizeOnDrop` auf `MasterKey` |
| Secret-Purge bei Lock | `SecretPayload::zeroize_secrets()` vor `entries.clear()` |
| **Atomic Writes** | Temp-Datei `.oxid.tmp` → `fsync` → `rename` (crash-safe) |
| **Lock-on-Minimize** | Tauri `WindowEvent::Focused(false)` + `is_minimized()` → sofortiger Lock |
| Kein Klartext in Logs | Kein `Debug`-Output für sensitive Structs |
| Release-Härtung | `panic = "abort"`, `strip = true`, `LTO` |

#### Atomic Writes (Enterprise Hardening)

> **Status:** ✅ `crates/vault-core/src/format.rs` · `atomic_write_vault()`

Verhindert korrupte `.oxid`-Dateien bei Absturz oder Stromausfall während des Speicherns:

```
encrypt(payload) → write vault.oxid.tmp → sync_all()
                         │
                         ▼
              fs::rename(.tmp → .oxid)   ← atomar (gleiches Volume)
                         │
              Bei Fehler: .tmp wird gelöscht, Original bleibt intakt
```

| Aspekt | Detail |
|---|---|
| **Temp-Datei** | `{vault}.oxid.tmp` neben der Zieldatei |
| **Sync** | `File::sync_all()` vor Rename — Daten auf Platte |
| **Rename** | `std::fs::rename` — atomares Ersetzen |
| **Einsatz** | `write_vault_file` (Create) und `update_vault_file` (Update) |

#### Lock-on-Minimize (Enterprise Hardening)

> **Status:** ✅ `src-tauri/src/window_events.rs` · Event `vault-locked`

Sofort-Sperre wenn der Admin das Fenster minimiert — kein Warten auf Auto-Lock-Timer:

```
Fenster minimiert
      │
      ▼
WindowEvent::Focused(false) + is_minimized() == true
      │
      ▼
perform_lock()  [SSH disconnect + Vault::lock() + RAM-Purge]
      │
      ▼
Tauri Event `vault-locked` { reason: "minimize", info }
      │
      ▼
Frontend: Lock-Screen, Passwort erforderlich
```

| Aspekt | Detail |
|---|---|
| **Trigger** | Nur Minimieren — Alt-Tab (Fokusverlust ohne Minimize) sperrt **nicht** |
| **Backend** | Identische Lock-Pipeline wie `lock_vault` / Auto-Lock |
| **Frontend** | Listener auf `vault-locked` → UI-Reset + Hinweis |
| **Wiederherstellen** | Master-Passwort Pflicht via `unlock_vault` |

#### RAM-Purge beim Auto-Lock / manuellen Lock (v0.1.0)

> **Status:** ✅ Backend `vault.lock()` · Frontend `useAutoLock`

Bei jeder Sperrung (`lock_vault`, Auto-Lock, Lock-on-Minimize, `Ctrl+L`) werden entschlüsselte Daten aggressiv aus dem Arbeitsspeicher entfernt:

```
Auto-Lock (120s Inaktivität) oder Ctrl+L
         │
         ▼
Frontend: performLock()
  · cancelSecureClipboardClear()
  · lockVault() IPC
  · React-State leeren (entries, selectedEntry, password)
  · screen → "unlock" (roter Status-Badge)
         │
         ▼
Backend: Vault::lock()
  1. Für jeden Eintrag: SecretPayload::zeroize_secrets()
     (Passwort, Token, Private Key, Passphrase → überschrieben)
  2. master_key = None → MasterKey::drop() → ZeroizeOnDrop (32 Byte → 0)
  3. entries.clear()
  4. locked = true
```

| Komponente | Purge-Mechanismus |
|---|---|
| **Master-Key** | `#[derive(Zeroize, ZeroizeOnDrop)]` auf `MasterKey([u8; 32])` |
| **Secret-Strings** | `String::zeroize()` auf Passwort, Token, Keys vor Drop |
| **Frontend-State** | Einträge, Detail-View, Formular-State zurücksetzen |
| **Clipboard** | Laufender Auto-Clear-Timer wird abgebrochen |

**Auto-Lock-Parameter:**

| Parameter | Wert |
|---|---|
| **Inaktivitäts-Timeout** | 120 Sekunden (2 Minuten) |
| **Implementierung** | `src/hooks/useAutoLock.ts` |
| **Aktivitäts-Events** | `mousemove`, `mousedown`, `keydown`, `scroll`, `wheel`, `touchstart` |
| **Aktiv nur wenn** | Vault entsperrt (`screen === "vault"`) |

### Passwort-Generator (v0.1.0)

> **Status:** ✅ `crates/vault-core/src/generator.rs` · Tauri `generate_password_cmd`

| Parameter | Wert |
|---|---|
| **Standardlänge** | 24 Zeichen |
| **Längenbereich** | 8–128 Zeichen |
| **Zeichensätze** | Großbuchstaben, Kleinbuchstaben, Zahlen, Sonderzeichen (konfigurierbar) |
| **RNG** | `rand::rngs::OsRng` (CSPRNG — kryptografisch sicher) |
| **Garantie** | Mindestens ein Zeichen pro aktivem Zeichensatz |
| **Shuffle** | Fisher-Yates nach Aufbau |

**Frontend:** `PasswordGeneratorModal` · Shortcut `Ctrl+G` · Schlüssel-Icon (`PasswordGenerateButton`) neben Secret-Passwortfeldern

**Formular-Kopplung:** Beim Öffnen aus einem Secret-Formular wird ein `onApply`-Callback registriert. „Übernehmen" (Inline + Footer) und „Kopieren" tragen das generierte Passwort direkt in das aktive Formularfeld ein — kein manuelles Einfügen nötig.

**Hinweis:** Der Generator benötigt keinen entsperrten Vault — reine Utility-Funktion im Rust-Kern.

### Clipboard Auto-Clear (v0.1.0)

> **Status:** ✅ Implementiert in `src/lib/secureClipboard.ts`

OxidVault behandelt die System-Zwischenablage als **ephemeren Kanal** — kopierte Secrets dürfen nicht dauerhaft außerhalb des Vaults verbleiben.

| Parameter | Wert |
|---|---|
| **Auto-Clear-Delay** | 30 Sekunden (exakt) |
| **Implementierung** | Frontend (`navigator.clipboard`) |
| **Clear-Strategie** | Überschreiben mit leerem String — nur wenn Zwischenablage noch den kopierten Wert enthält |
| **Timer-Reset** | Neuer Kopiervorgang ersetzt laufenden Timer |
| **Abbruch bei Lock** | `cancelSecureClipboardClear()` beim Vault-Sperren |

**UX-Feedback:**

- Button-Label: `Kopiert! (29s)` … Countdown bis Clear
- Toast (`ClipboardToast`): „In Zwischenablage kopiert — wird in Xs automatisch geleert“
- Grüne Button-Hervorhebung während Countdown aktiv

**Ablauf:**

```
Kopieren → writeText(secret) → Timer 30s starten
         → Countdown UI (1s-Ticks)
         → Nach 30s: readText() === secret ? writeText("") : skip
         → Bei lock_vault: Timer abbrechen
```

---

## 4. Verzeichnisstruktur

```
OxidVault/
├── ARCHITECTURE.md          ← Diese Datei (Single Source of Truth)
├── Cargo.toml               ← Rust-Workspace-Root
├── rust-toolchain.toml      ← Rust-Toolchain-Pinning
├── package.json             ← Frontend-Abhängigkeiten & npm-Scripts
├── vite.config.ts           ← Vite + Tailwind + Tauri-Dev-Server
├── tsconfig*.json           ← TypeScript-Konfiguration
├── index.html               ← Frontend-Einstiegspunkt
│
├── crates/
│   └── vault-core/          ← ★ Rust-Kern (Krypto, Vault-Domain)
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs       ← Re-Exports
│           ├── crypto.rs    ← Argon2id KDF, AES-256-GCM
│           ├── format.rs    ← .oxid Lesen/Schreiben
│           ├── entry.rs     ← SecretEntry-Typen
│           ├── vault.rs     ← Vault-Lifecycle, Persistenz
│           ├── policy.rs    ← Master-Passwort-Richtlinie
│           ├── generator.rs ← CSPRNG Passwort-Generator
│           ├── audit.rs     ← Offline Security Audit (Duplikate, Schwäche, Score)
│           ├── expiry.rs    ← Passwort-Ablauf (YYYY-MM-DD, 14-Tage-Warnung)
│           └── probe.rs     ← Host/Port-Auflösung für Live-Ping
│           └── error.rs     ← VaultError
│
├── src/                     ← ★ Frontend (React + TypeScript)
│   ├── main.tsx             ← React-Bootstrap
│   ├── App.tsx              ← Root-Komponente, Vault-UI
│   ├── components/          ← Wiederverwendbare UI-Bausteine
│   │   └── Layout.tsx
│   ├── hooks/               ← Custom React Hooks
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useAutoLock.ts
│   │   └── useSecureCopy.ts
│   ├── lib/                 ← IPC, Dialoge, Theme, Suche, Clipboard
│   │   ├── ipc.ts
│   │   └── dialog.ts
│   ├── types/               ← Shared TypeScript-Typen
│   │   └── vault.ts
│   └── styles/
│       └── globals.css      ← Tailwind + Design-Tokens
│
├── src-tauri/               ← ★ Tauri-Backend (Desktop-Shell)
│   ├── Cargo.toml
│   ├── tauri.conf.json      ← Tauri-App-Konfiguration
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json     ← Tauri v2 Permission-Capabilities
│   ├── icons/               ← App-Icons (via `npm run icons` aus `logo.png`)
│   └── src/
│       ├── main.rs          ← Binary-Einstiegspunkt
│       ├── lib.rs           ← Tauri Builder, Plugin-Init, State
│       ├── probe/             ← Async TCP-Reachability-Checks
│       │   └── mod.rs
│       │   └── mod.rs
│       ├── window_events.rs ← Lock-on-Minimize (Tauri Window Events)
│       ├── settings.rs      ← App-Einstellungen (Vault-Pfad, Git-Sync, kein Secret)
│       ├── git_sync.rs      ← Git pull/commit/push via std::process::Command
│       └── commands/
│           ├── mod.rs       ← Tauri Command-Handler
│           ├── bootstrap.rs ← Smart-Start, Vault abkoppeln
│           ├── lock.rs      ← perform_lock (RAM-Purge)
│           ├── open_url.rs  ← Sicheres Öffnen von http(s)-URLs
│           └── ssh.rs       ← ssh_connect / ssh_write / ssh_disconnect
│
├── public/                  ← Statische Assets (SVG, etc.)
├── scripts/                 ← Build-Hilfsskripte
│   └── generate-icons.mjs
└── dist/                    ← Vite-Production-Build (generiert)
```

### Verantwortungstrennung

| Schicht | Pfad | Darf wissen / tun |
|---|---|---|
| **Frontend** | `src/` | UI rendern, Shortcuts, IPC-Aufrufe |
| **IPC** | `src/lib/ipc.ts` ↔ `src-tauri/src/commands/` | Typisierte Request/Response-Grenze |
| **Shell** | `src-tauri/` | Window-Management, Plugins, App-State |
| **Kern** | `crates/vault-core/` | Krypto, Persistenz, Business-Logik |

---

## 5. Systemarchitektur

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
    VAULT -- ".oxid Datei" --> DISK[(Lokales Dateisystem)]
```

### Datenfluss: Secret speichern

1. User legt Secret im Frontend an (`Ctrl+N` → Formular).
2. Frontend ruft `add_entry({ input })` auf.
3. `vault-core` erstellt `SecretEntry`, serialisiert Payload als JSON.
4. Payload wird mit AES-256-GCM verschlüsselt und atomar in die `.oxid`-Datei geschrieben.
5. Frontend erhält nur `SecretEntrySummary` (ohne `secret`-Feld).

### Datenfluss: Secret bearbeiten (Data Mutation)

1. User wählt Eintrag in der Sidebar → `EntryDetail` zeigt Details.
2. Klick auf **Bearbeiten** → `NewSecretModal` im Modus `edit`, vorausgefüllt via `get_entry`.
3. User passt Felder an (optional: Passwort-Generator → direkte Feldübernahme).
4. Frontend ruft `update_entry({ id, input })` auf.
5. `vault-core::Vault::update_entry`:
   - Validiert Eingabe, prüft unveränderten Eintragstyp
   - Behält `id` + `created_at`, setzt `updated_at` neu
   - Ersetzt Eintrag im RAM, ruft `persist()` auf
6. Gesamter Vault-Body wird AES-256-GCM neu verschlüsselt und in `.oxid` geschrieben.
7. Frontend aktualisiert Sidebar (`list_entries`) und Detailansicht (`get_entry`).

```
Bearbeiten → Modal (edit) → update_entry → persist() → AES-256-GCM → .oxid
                              ↓
                    list_entries + get_entry → Sidebar + Detail refresh
```

### Datenfluss: SSH Quick Connect

> **Status:** ✅ `russh` · `src-tauri/src/ssh/` · `SshTerminalModal` (xterm.js)

```
Quick Connect (entry_id)
        │
        ▼
ssh_connect ──► Vault::get_entry(id)  [Key bleibt im Rust-RAM]
        │              │
        │              ▼
        │         russh: TCP → Handshake → Pubkey-Auth → PTY Shell
        │              │
        │              ├──► Tauri Event `ssh-data` (stdout/stderr, base64)
        │              └──► Tauri Event `ssh-closed` (EOF / exit / Fehler)
        ▼
SshTerminalModal (xterm.js)
        │
        ├── listen(`ssh-data`) → term.write()
        └── onData → ssh_write(session_id, stdin) → Rust Channel
```

| Aspekt | Detail |
|---|---|
| **SSH-Crate** | `russh` + `russh-keys` (Pure Rust, kein OpenSSL/Perl nötig) |
| **Credentials** | Nur via `entry_id` — Private Key **nie** ans Frontend |
| **Streaming** | Bidirektional: Events (Out) + `ssh_write` Command (In) |
| **Terminal-UI** | `@xterm/xterm` + `@xterm/addon-fit`, Theme aus CSS-Variablen |
| **Session-Ende** | Server `exit` → `ssh-closed` → Modal schließt automatisch |
| **Vault-Lock** | `lock_vault` → `disconnect_all_ssh()` — Sessions werden beendet |
| **Key-Sicherheit** | Kein Kopieren des Private Keys; `zeroize` nach Session-Thread |

**Tauri Commands:** `ssh_connect`, `ssh_write`, `ssh_disconnect`  
**Tauri Events:** `ssh-data`, `ssh-closed`

**Hinweis Host-Keys:** v0.1 akzeptiert Server-Keys für Admin-Quick-Connect (TOFU-Whitelist folgt optional).

### Datenfluss: Web-Login — Website öffnen

> **Status:** ✅ `open_website_url` · `src/lib/openWebsite.ts` · Button in `EntryDetail`

```
Website öffnen (Web-Login-Eintrag)
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

| Aspekt | Detail |
|---|---|
| **UI** | Button **„Website öffnen“** (↗) neben dem URL-Feld in `EntryDetail` |
| **Theme** | CSS-Variablen (`vault-accent`, `vault-border`) — passt zu allen Themes |
| **Validierung (Frontend)** | `validateHttpUrl()` — Auto-`https://` für bare Domains, dann Scheme/Host-Check |
| **Validierung (Backend)** | `normalize_http_url()` + `validate_http_url()` — autoritative Prüfung vor OS-Aufruf |
| **Auto-Protokoll** | Fehlt `http://`/`https://` und kein anderes Scheme → `https://` voranstellen (z. B. `google.de` → `https://google.de`) |
| **Erlaubte Schemes** | Nur `http://` und `https://` — kein `javascript:`, `file:`, `data:` etc. |
| **Injection-Schutz** | Trim, Ablehnung von Steuerzeichen/Leerzeichen, `url::Url::parse` + Scheme-Whitelist |
| **Browser-Öffnen** | Rust-Crate `open` (via Tauri-Shell-Stack) — kein `window.open` im WebView |

**Tauri Command:** `open_website_url`  
**Capability:** `shell:allow-open` (bereits in `capabilities/default.json`)

### Live-Ping & Service-Status (Infrastruktur)

> **Status:** ✅ `check_entries_reachability` · `vault-core/probe.rs` · `useReachabilityPolling` · `ReachabilityDot`

```
Frontend (alle 10s, non-blocking)
        │
        ▼
check_entries_reachability(entry_ids[])
        │
        ├── Vault::get_entry → resolve_probe_target()
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
ReachabilityDot — Sidebar + Detailansicht
```

| Aspekt | Detail |
|---|---|
| **Methode** | Async TCP-Connect (`tokio::net::TcpStream`) — plattformübergreifend, kein ICMP |
| **Intervall** | 10 Sekunden (`useReachabilityPolling`), solange Vault entsperrt |
| **Parallelität** | Pro Eintrag eigener `tokio::spawn` — blockiert UI nicht |
| **Fehlertoleranz** | Timeouts/Host unreachable → `offline`; Join-Fehler → still ignoriert; App crasht nie |
| **UI-Status** | Grau pulsierend = checking · Grün pulsierend = online · Rot = offline |
| **Probeable Typen** | `web_login`, `ssh_key`, `database` — API/WLAN/Notiz: kein Punkt |

**Tauri Command:** `check_entries_reachability`

### Datenfluss: Vault entsperren

1. User gibt Master-Passwort im Frontend ein.
2. Frontend ruft `open_vault` (Erstöffnung) oder `unlock_vault` (Re-Unlock nach Lock) auf.
3. Tauri Command leitet an `vault-core::Vault` weiter.
4. `vault-core` leitet via Argon2id den Master-Key ab und entschlüsselt die `.oxid`-Datei.
5. `VaultInfo` kehrt ans Frontend zurück — Secrets nur über `get_entry(id)` auf explizite Anfrage.

---

## 6. API-Schnittstellen (Tauri Commands)

> Alle Commands sind synchron, laufen im Rust-Backend und geben `Result<T, String>` zurück.

| Command | Parameter | Rückgabe | Beschreibung | Status |
|---|---|---|---|---|
| `health_check` | — | `String` | Backend-Liveness-Probe (`"ok"`) | ✅ |
| `get_vault_info` | — | `VaultInfo` | Metadaten des aktuellen Vaults | ✅ |
| `bootstrap_vault` | — | `VaultInfo` | App-Start: gespeicherten Vault-Pfad laden (falls Datei existiert) | ✅ |
| `detach_vault` | — | `()` | In-Memory-Vault zurücksetzen (für „Anderen Tresor öffnen“) | ✅ |
| `create_vault` | `path`, `name`, `password` | `VaultInfo` | Neue `.oxid`-Datei anlegen und entsperren; Pfad speichern | ✅ |
| `open_vault` | `path`, `password` | `VaultInfo` | Bestehende `.oxid`-Datei öffnen; Pfad speichern | ✅ |
| `unlock_vault` | `password` | `VaultInfo` | Gesperrten Vault erneut entsperren (Pfad im State) | ✅ |
| `lock_vault` | — | `VaultInfo` | Vault sperren, Key + Einträge aus RAM löschen | ✅ |
| `list_entries` | — | `SecretEntrySummary[]` | Eintragsliste ohne Secrets | ✅ |
| `add_entry` | `input: SecretEntryInput` | `SecretEntrySummary` | Secret hinzufügen und Vault persistieren | ✅ |
| `update_entry` | `id`, `input: SecretEntryInput` | `SecretEntrySummary` | Bestehendes Secret aktualisieren und persistieren | ✅ |
| `get_entry` | `id: String` | `SecretEntry` | Vollständigen Eintrag inkl. Secret laden | ✅ |
| `generate_password_cmd` | `options: PasswordGenOptions` | `String` | CSPRNG-Passwort generieren (kein Vault nötig) | ✅ |
| `open_website_url` | `url: String` | `()` | Validierte http(s)-URL im Standard-Browser öffnen | ✅ |
| `check_entries_reachability` | `entry_ids: String[]` | `EntryReachabilityStatus[]` | Async TCP-Reachability für Infrastruktur-Einträge | ✅ |
| `audit_vault_security` | — | `SecurityAuditReport` | Offline-Passwort-Audit (Duplikate, Schwäche, Score) | ✅ |
| `get_app_settings` | — | `AppSettings` | Lokale App-Einstellungen laden | ✅ |
| `update_git_sync_settings` | `enabled`, `remote_url?` | `AppSettings` | Git-Sync-Konfiguration speichern | ✅ |
| `sync_vault_git` | — | `GitSyncResult` | Git pull → commit/push der verschlüsselten `.oxid` | ✅ async |
| `ssh_connect` | `entry_id: String` | `SshSessionInfo` | SSH-Session starten (Key aus Vault-RAM) | ✅ |
| `ssh_write` | `session_id`, `data: String` | `()` | Terminal-Stdin an SSH-Kanal senden | ✅ |
| `ssh_disconnect` | `session_id: String` | `()`` | SSH-Session beenden | ✅ |

### Typen

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

| Feld | Typ | Beschreibung |
|---|---|---|
| `version` | `string` | Vault-Core-Version |
| `name` | `string` | Anzeigename des Vaults |
| `path` | `string \| null` | Pfad zur `.oxid`-Datei |
| `entry_count` | `number` | Anzahl gespeicherter Einträge |
| `locked` | `boolean` | `true` = Vault gesperrt |
| `initialized` | `boolean` | `true` = Vault-Datei geladen/angelegt |

#### Secret-Typen (`SecretPayload`)

> **Status:** ✅ Implementiert in `crates/vault-core/src/entry.rs`  
> Serialisierung als **internally-tagged JSON** mit `"type"`-Feld (flach in `SecretEntry` via `#[serde(flatten)]`).

| `type` | Label | Pflichtfelder | Optionale Felder |
|---|---|---|---|
| `web_login` | Web-Login | `title`, `url`, `username`, `password` | `notes` |
| `ssh_key` | SSH-Key | `title`, `host`, `username`, `private_key` | `passphrase` |
| `api_token` | API-Token | `title`, `service`, `token` | — |
| `database` | Datenbank | `title`, `host`, `port`, `db_type`, `database_name`, `username`, `password` | — |
| `network_wifi` | Netzwerk / WLAN | `title`, `ssid`, `encryption_type`, `password` | — |
| `secure_note` | Sichere Notiz | `title`, `content` | — |

**Beispiel `web_login` (Klartext vor Verschlüsselung):**

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

**Beispiel `ssh_key`:**

```json
{
  "id": "uuid",
  "title": "Prod Bastion",
  "type": "ssh_key",
  "host": "10.0.0.1",
  "username": "deploy",
  "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
  "passphrase": "…"
}
```

**Beispiel `api_token`:**

```json
{
  "id": "uuid",
  "title": "Stripe Live",
  "type": "api_token",
  "service": "Stripe",
  "token": "sk_live_…"
}
```

**Beispiel `database`:**

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

**Beispiel `network_wifi`:**

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

**Beispiel `secure_note`:**

```json
{
  "id": "uuid",
  "title": "nginx.conf",
  "type": "secure_note",
  "content": "server { listen 443 ssl; … }"
}
```

**`db_type`-Werte (Dropdown):** `postgresql`, `mysql`, `mariadb`, `mssql`, `sqlite`, `mongodb`, `redis`, `oracle`, `other`  
**`encryption_type`-Werte (Dropdown):** `wpa3`, `wpa2`, `wpa`, `wep`, `open`, `enterprise`, `other`

#### `SecretEntrySummary` (Listenansicht)

| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | `string` | UUID |
| `title` | `string` | Anzeigename |
| `folder` | `string?` | Optionale Hauptkategorie / Ordner |
| `tags` | `string[]` | Optionale Etiketten (normalisiert, dedupliziert) |
| `entry_type` | `web_login \| ssh_key \| api_token \| database \| network_wifi \| secure_note` | Typ für Sidebar-Icon |
| `subtitle` | `string?` | URL (Web), Host (SSH), Service (API), DB-/WLAN-Info, Notiz-Vorschau |
| `username` | `string?` | Benutzername (Web-Login, SSH-Key, Datenbank) |
| `updated_at` | `string` | Unix-Timestamp (Sekunden) |

### Passwort-Ablauf / Compliance (v0.1.0)

> **Status:** ✅ `expires_at` auf `SecretEntry` · `vault-core/expiry.rs` · `ExpiryBadge` · Security-Dashboard-Kachel

| Aspekt | Detail |
|---|---|
| **Datenmodell** | `expires_at: Option<String>` auf `SecretEntry` / `SecretEntryInput` — Format `YYYY-MM-DD` |
| **Verschlüsselung** | Feld Teil des JSON-Body → AES-256-GCM wie alle Secret-Metadaten |
| **Formular** | `NewSecretModal`: optionales HTML-`type="date"`-Feld „Ablaufdatum / Gültig bis“ |
| **Detailansicht** | `ExpiryBadge` unter dem Titel — rot wenn abgelaufen, amber wenn ≤ 14 Tage |
| **Datumskalkulation** | Reine Kalendertage (`YYYY-MM-DD`), lokales Datum — keine UTC-Zeitverschiebung |
| **Security Dashboard** | Vierte Kachel „Ablaufende Passwörter“ + To-Do-Liste unten im Dashboard |
| **Audit-Backend** | `audit.rs` + `expiry.rs` — `expiring_entries` mit `status`: `expired` \| `expiring_soon` |

### Echtzeit-Suche (v0.1.0)

> **Status:** ✅ `src/lib/search.ts` · Sidebar-Filter in `App.tsx`

| Aspekt | Detail |
|---|---|
| **Trigger** | Tippen im Suchfeld oder `Ctrl+K` |
| **Filterung** | Client-seitig, Echtzeit (kein Backend-Roundtrip) |
| **Felder** | Titel, Ordner, Tags, URL/Host/Service (`subtitle`), Benutzername, Typ-Label |
| **Token-Logik** | Mehrere Wörter = AND-Verknüpfung (alle müssen matchen) |
| **Anzeige** | Trefferzähler `3/12` bei aktiver Suche/Tag, „Keine Treffer“ bei leerem Ergebnis |

### Ordner & Tags (v0.1.0 — Runde 2)

> **Status:** ✅ `folder` + `tags` auf `SecretEntry` · AES-256-GCM in `.oxid` · `SidebarTagFilter` · `SidebarEntryList`

| Aspekt | Detail |
|---|---|
| **Datenmodell** | `folder: Option<String>`, `tags: Vec<String>` auf `SecretEntry` / `SecretEntryInput` / `SecretEntrySummary` |
| **Verschlüsselung** | Felder Teil des JSON-Body → AES-256-GCM wie alle anderen Secret-Metadaten |
| **Normalisierung** | Ordner getrimmt; Tags dedupliziert (case-insensitive), leere Werte verworfen |
| **Formular** | `NewSecretModal`: Ordner-Textfeld + `TagInput` (Badges, Enter/Komma zum Hinzufügen) |
| **Tag-Filter** | Einklappbares Sidebar-Menü unter der Suche — klickbare Badges (`--color-vault-tag`, Dracula: Pink `#ff79c6`) |
| **Ordner-Gruppierung** | Wenn mindestens ein Eintrag einen Ordner hat: einklappbare Ordner-Überschriften in der Sidebar |
| **Filter-Logik** | `filterEntries(entries, query, activeTag, dashboardFilter)` — Tag, Textsuche und Dashboard-Filter kombinierbar |

**Beispiel-Eintrag mit Organisation:**

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

### Security Audit Dashboard (v0.1.0 — Runde 3)

> **Status:** ✅ `audit_vault_security` · `vault-core/audit.rs` · `SecurityDashboard.tsx`

| Aspekt | Detail |
|---|---|
| **Navigation** | Sidebar-Tabs **Secrets** / **Security** oben in der linken Leiste |
| **Analyse-Ort** | Vollständig offline im Rust-RAM — Passwörter verlassen nie den Prozess |
| **Response** | Nur Metadaten: IDs, Titel, Gründe, Scores — **keine Klartext-Passwörter** |
| **Duplikate** | Gruppiert nach identischem Secret (Web-Login, DB, WLAN, API-Token, SSH-Passphrase) |
| **Schwache Secrets** | `< 12` Zeichen **oder** keine Ziffer **oder** kein Sonderzeichen |
| **Ablaufende Passwörter** | `expires_at` gesetzt und abgelaufen oder ≤ 14 Kalendertage |
| **Score** | 0–100 % — Abzüge für schwache Anteile und Duplikat-Exemplare |
| **Klickbare Kacheln** | Schwache / Duplikat / Ablaufende Kacheln filtern die Sidebar (Tab **Secrets**) |
| **Filter-Badge** | `DashboardFilterBar` über der Eintragsliste — ✕ oder Tag **Alle** hebt Filter auf |

**Tauri Command:** `audit_vault_security`

**Dashboard → Sidebar-Filter:** `buildDashboardFilter()` in `src/types/dashboardFilter.ts` · `filterEntries(..., dashboardFilter)` in `src/lib/search.ts`

### Sidebar Quick-Actions (v0.1.0)

> **Status:** ✅ `SidebarEntryItem.tsx` · Hover-Aktionen in der Eintragsliste

| Eintragstyp | Quick-Actions (Sidebar-Zeile) |
|---|---|
| `web_login` | **⎘** Passwort kopieren (`get_entry` → Secure Clipboard) · **↗** Website öffnen (`open_website_url`, URL aus `subtitle`) |
| `ssh_key` | **▶** Quick Connect (`ssh_connect`, Key bleibt im Rust-RAM) |
| andere | keine Inline-Aktionen (Detailansicht) |

| Aspekt | Detail |
|---|---|
| **Sichtbarkeit** | Aktionen erscheinen bei Hover; bei ausgewähltem Eintrag dauerhaft sichtbar |
| **Design** | Dezente Mono-Icons, Theme-Variablen — kein visuelles Überladen (Dracula-kompatibel) |
| **Sidebar-Breite** | `w-64` für Platz neben Titel/Subtitle |

#### IPC-Typen

| Typ | Verwendung |
|---|---|
| `SecretEntryInput` + `SecretPayload` | Eingabe via `add_entry` / `update_entry` |
| `SecretEntrySummary` | Sidebar-Liste, Rückgabe von `add_entry` / `update_entry` |
| `SecretEntry` (vollständig, inkl. Payload) | Detailansicht via `get_entry` |

### Frontend-IPC-Mapping

| TypeScript (`src/lib/ipc.ts`) | Tauri Command |
|---|---|
| `healthCheck()` | `health_check` |
| `getVaultInfo()` | `get_vault_info` |
| `bootstrapVault()` | `bootstrap_vault` |
| `detachVault()` | `detach_vault` |
| `createVault(path, name, password)` | `create_vault` |
| `openVault(path, password)` | `open_vault` |
| `unlockVault(password)` | `unlock_vault` |
| `lockVault()` | `lock_vault` |
| `listEntries()` | `list_entries` |
| `addEntry(input)` | `add_entry` |
| `updateEntry(id, input)` | `update_entry` |
| `getEntry(id)` | `get_entry` |
| `generatePassword(options)` | `generate_password_cmd` |
| `openWebsiteUrl(url)` | `open_website_url` |
| `checkEntriesReachability(entryIds)` | `check_entries_reachability` |
| `auditVaultSecurity()` | `audit_vault_security` |
| `getAppSettings()` | `get_app_settings` |
| `updateGitSyncSettings(enabled, remoteUrl)` | `update_git_sync_settings` |
| `syncVaultGit()` | `sync_vault_git` |
| `sshConnect(entryId)` | `ssh_connect` |
| `sshWrite(sessionId, data)` | `ssh_write` |
| `sshDisconnect(sessionId)` | `ssh_disconnect` |

#### `PasswordGenOptions`

| Feld | Typ | Default |
|---|---|---|
| `length` | `number` | `24` |
| `uppercase` | `boolean` | `true` |
| `lowercase` | `boolean` | `true` |
| `digits` | `boolean` | `true` |
| `symbols` | `boolean` | `true` |

---

## 7. Dateiformate

### `.oxid` — OxidVault-Dateiformat

> **Status:** ✅ Implementiert in `crates/vault-core/src/format.rs` (Version 1).

```
┌──────────────────────────────────────────────┐
│  Header (Klartext)                           │
│  ─ Magic: "OXID" (4 Byte)                    │
│  ─ Format-Version: u16 LE (= 1)              │
│  ─ KDF memory_kib: u32 LE                    │
│  ─ KDF iterations: u32 LE                    │
│  ─ KDF parallelism: u32 LE                   │
│  ─ Salt: 16 Byte                             │
│  ─ Name-Länge: u16 LE + Name (UTF-8)         │
├──────────────────────────────────────────────┤
│  Nonce: 12 Byte (zufällig pro Speichervorgang)│
├──────────────────────────────────────────────┤
│  Ciphertext + GCM Auth-Tag (128 Bit)         │
│  ─ Klartext: JSON { "entries": [...] }       │
└──────────────────────────────────────────────┘
```

| Eigenschaft | Wert |
|---|---|
| **Extension** | `.oxid` |
| **Magic Bytes** | `0x4F 0x58 0x49 0x44` (`"OXID"`) |
| **Versionierung** | Header-Version für Forward-Compatibility |
| **Integrität** | GCM Auth-Tag pro Body-Block |

---

## 8. Frontend-Architektur

### Design-System

- **Themes:** 4 wählbare Dark-Themes via `data-theme` auf `<html>` (siehe unten)
- **Design-Tokens:** Tailwind-Utilities `vault-*` (CSS-Variablen in `globals.css`)
- **Typografie:** System-Sans + Monospace; Matrix-Theme erzwingt Monospace global
- **Layout:** Header (Theme + Status) · Main (Sidebar + Content) · Footer (Shortcut-Hints)

### Dynamisches Theme-System (v0.1.0)

> **Status:** ✅ `src/lib/theme.ts` · `SettingsMenu` · `localStorage`

| Aspekt | Detail |
|---|---|
| **UI** | Zahnrad-Dropdown oben rechts im Header (`SettingsMenu`: Theme + Git-Sync) |
| **Mechanismus** | `document.documentElement.setAttribute("data-theme", id)` |
| **CSS** | Pro Theme überschreibt `[data-theme="…"]` die `--color-vault-*` Variablen |
| **Persistenz** | `localStorage` Key `oxidvault-theme` — Restore via `initTheme()` in `main.tsx` |
| **Scope** | Gesamte App: Sidebar, Detail, Modals, Toasts (alle `vault-*` Klassen) |

**Verfügbare Themes:**

| ID | Name | Charakter |
|---|---|---|
| `oxid` | Oxid Default | Dunkelblau, aktuelles Standard-Design |
| `dracula` | Dracula | Violett/Purpur-Akzente |
| `nord` | Nord Arctic | Eisiges Blaugrau |
| `matrix` | Matrix Green | Tiefschwarz, Neon-Grün, Monospace-UI |

**Ablauf:**

```
App-Start → initTheme() liest localStorage → data-theme setzen
User wählt Theme → applyTheme() → localStorage + CustomEvent
Alle Komponenten nutzen unverändert bg-vault-* / text-vault-* Utilities
```

### Keyboard-Shortcuts

| Shortcut | Aktion | Status |
|---|---|---|
| `Ctrl+L` | Vault sperren | ✅ Implementiert |
| `Ctrl+K` | Suche fokussieren + Text markieren | ✅ Implementiert |
| `Ctrl+N` | Neues Secret | ✅ Implementiert |
| `Ctrl+G` | Passwort-Generator öffnen | ✅ Implementiert |

### Vault-Setup-Flows (UI)

#### Neuen Vault anlegen

1. Welcome-Screen → **Neuen Vault anlegen**
2. Master-Passwort (+ optionaler Vault-Name) eingeben
3. Speicher-Dialog: `.oxid`-Datei wählen (`pickVaultSavePath`)
4. Backend (`create_vault`):
   - 16-Byte Salt generieren (`crypto::random_salt`)
   - Argon2id → 256-Bit Master-Key
   - Leere `VaultPayload { entries: [] }` als JSON serialisieren
   - AES-256-GCM verschlüsseln → Datei schreiben
5. Status-Badge: **entsperrt** (grün) → Tresor-Ansicht  
6. Absoluter Dateipfad wird in `settings.json` (App-Data) gespeichert — **nur der Pfad, keine Secrets**

#### Bestehenden Vault öffnen

1. Welcome-Screen → **Bestehenden Vault öffnen**
2. Öffnen-Dialog: `.oxid`-Datei wählen (`pickVaultOpenPath`)
3. Master-Passwort eingeben
4. Backend (`open_vault`):
   - Salt + KDF-Parameter aus Header lesen
   - Argon2id → Master-Key ableiten
   - AES-256-GCM entschlüsseln (Fehler → falsches Passwort)
5. Status-Badge: **entsperrt** (grün) → Tresor-Ansicht  
6. Absoluter Dateipfad wird in `settings.json` (App-Data) gespeichert

#### Smarter App-Start (zuletzt geöffneter Tresor)

1. Beim Start ruft das Frontend `bootstrap_vault` auf (parallel zu `health_check`).
2. Backend liest `{appDataDir}/settings.json` → Feld `lastVaultPath`.
3. Wenn die Datei am Pfad noch existiert: `Vault::attach_locked(path)` — Metadaten aus Header, **locked**, kein Master-Key im RAM.
4. Frontend überspringt den Welcome-Screen → direkt **Unlock**-Ansicht mit Pfad-Anzeige.
5. Fehlt die Datei oder ist der Pfad ungültig: normaler Welcome-Screen.
6. Auf dem Unlock-Screen: Link **„Anderen Tresor öffnen“** → `detach_vault` → Welcome-Screen (gespeicherter Pfad bleibt erhalten bis ein anderer Vault geöffnet wird).

#### Lokale App-Einstellungen (`settings.json`)

| Feld | Typ | Inhalt |
|---|---|---|
| `lastVaultPath` | `string?` | Absoluter Pfad zur zuletzt geöffneten `.oxid`-Datei |
| `gitSync.enabled` | `boolean` | Git-Synchronisation aktiv/inaktiv |
| `gitSync.remoteUrl` | `string?` | Remote-Repository-URL oder Pfad (z. B. `https://…` oder `file://…`) |

**Speicherort:** OS-spezifisches App-Data-Verzeichnis via `app.path().app_data_dir()` (z. B. `%APPDATA%/com.oxidvault.app/` unter Windows).

**Sicherheit:** Es werden ausschließlich Dateipfade und Git-Remote-Konfiguration persistiert — niemals Master-Passwörter, Keys, Salts oder Secret-Inhalte.

### Git-Synchronisation (v0.1.0 — Runde 4)

> **Status:** ✅ `sync_vault_git` · `git_sync.rs` · `SettingsMenu` · `SyncButton`

| Aspekt | Detail |
|---|---|
| **Trigger** | Manueller ↻-Button im Header (links neben Status-Punkt), nur wenn Sync aktiv |
| **Konfiguration** | Zahnrad-Menü → Bereich „Git Synchronisation“ |
| **Ablauf** | 1. `git pull --ff-only origin` → 2. bei lokalen Änderungen `git add -A` → `commit -m "Vault Sync"` → `push` |
| **Repo-Wurzel** | Verzeichnis der `.oxid`-Datei (oder `git rev-parse --show-toplevel`) |
| **Erst-Setup** | `git init -b main` + `remote add origin` falls noch kein Repository |
| **Nach Pull** | `Vault::reload_from_disk()` — entsperrter Tresor wird neu eingelesen |
| **Implementierung** | `std::process::Command("git")` — keine externe Git-Library |
| **Sicherheit** | Nur die **verschlüsselte** `.oxid`-Datei wird übertragen; Klartext-Secrets verlassen nie den Prozess |

**Warum Git sicher ist:** Die `.oxid`-Datei ist vollständig mit AES-256-GCM verschlüsselt. Selbst auf öffentlichen Git-Servern (GitHub, GitLab) sind ohne Master-Passwort keine Secrets lesbar.

**Voraussetzung:** Git muss im System-PATH installiert sein. Authentifizierung erfolgt über die native Git-Konfiguration des Betriebssystems (SSH-Key, Credential Manager).

### Secret-UI

| Komponente | Pfad | Funktion |
|---|---|---|
| `NewSecretModal` | `src/components/NewSecretModal.tsx` | Create + Edit (`mode: create \| edit`), Typ-Auswahl, Generator-Integration |
| `PasswordGenerateButton` | `src/components/PasswordGenerateButton.tsx` | Schlüssel-Icon neben Passwort/Token/Passphrase-Feldern |
| `PasswordGeneratorModal` | `src/components/PasswordGeneratorModal.tsx` | CSPRNG-Generator (`Ctrl+G`), Feldübernahme via `onApply` |
| `EntryDetail` | `src/components/EntryDetail.tsx` | Detailansicht aller 6 Secret-Typen, Live-Status, Quick Connect, Website öffnen |
| `ReachabilityDot` | `src/components/ReachabilityDot.tsx` | Status-Punkt (online/offline/checking) für Infrastruktur |
| `useReachabilityPolling` | `src/hooks/useReachabilityPolling.ts` | 10s-Hintergrund-Polling via `check_entries_reachability` |
| `SecurityDashboard` | `src/components/SecurityDashboard.tsx` | Offline Security Audit — Score, klickbare Kacheln, To-Do-Listen |
| `DashboardFilterBar` | `src/components/DashboardFilterBar.tsx` | Aktiver Dashboard-Filter über der Sidebar (✕ zum Aufheben) |
| `dashboardFilter.ts` | `src/types/dashboardFilter.ts` | Filter-Typen und `buildDashboardFilter()` aus Audit-Report |
| `ExpiryBadge` | `src/components/ExpiryBadge.tsx` | Ablauf-Warnung in der Secret-Detailansicht |
| `expiry.ts` | `src/lib/expiry.ts` | Kalenderdatum-Parsing & 14-Tage-Logik (Frontend) |
| `TagInput` | `src/components/TagInput.tsx` | Badge-Eingabe für Tags (Enter/Komma) |
| `SidebarTagFilter` | `src/components/SidebarTagFilter.tsx` | Einklappbares Tag-Filter-Menü in der Sidebar |
| `SidebarEntryList` | `src/components/SidebarEntryList.tsx` | Eintragsliste mit optionaler Ordner-Gruppierung |
| `SidebarEntryItem` | `src/components/SidebarEntryItem.tsx` | Sidebar-Zeile mit Quick-Actions + Live-Status |
| `tags.ts` | `src/lib/tags.ts` | Tag-Sammlung, Filter, Ordner-Gruppierung |
| `SshTerminalModal` | `src/components/SshTerminalModal.tsx` | Integriertes xterm.js-Terminal, Theme-aware |
| `AppLogo` | `src/components/AppLogo.tsx` | Quadratisches App-Logo (`/logo.png`) in Header & Auth-Screens |
| `ThemeSelector` | `src/components/ThemeSelector.tsx` | *(ersetzt durch SettingsMenu)* |
| `SettingsMenu` | `src/components/SettingsMenu.tsx` | Zahnrad-Dropdown: Theme + Git-Sync-Einstellungen |
| `SyncButton` | `src/components/SyncButton.tsx` | Header-Sync-Trigger mit Spinner und Status-Toast |
| `ClipboardToast` | `src/components/ClipboardToast.tsx` | Toast-Hinweis für 30s Clipboard Auto-Clear |
| `SecretTypeIcon` | `src/components/SecretTypeIcon.tsx` | SVG-Icons für alle 6 Secret-Typen in Sidebar |
| `openWebsite.ts` | `src/lib/openWebsite.ts` | URL-Validierung + IPC zu `open_website_url` |

### State-Management

Aktuell: Lokaler React-State in `App.tsx` mit Screen-Flow (`welcome` → `create`/`open` → `vault`; Smart-Start: direkt `unlock`).  
Datei-Dialoge via `@tauri-apps/plugin-dialog` in `src/lib/dialog.ts`.

---

## 9. Build, Deployment & Betrieb

### Production (Release v1.0.0)

**Voraussetzungen:** Node.js 20+, Rust stable, WebView2 (Windows).

```bash
npm install
npm run icons          # Icons aus logo.png → src-tauri/icons/ (optional, falls Logo geändert)
npm run tauri:build    # Release-Build + MSI/NSIS (Windows: lädt Rust/MSVC-PATH via scripts/tauri-build.ps1)
```

| Artefakt | Pfad (Windows, nach erfolgreichem Build) |
|---|---|
| **MSI-Installer** | `target/release/bundle/msi/OxidVault_1.0.0_x64_en-US.msi` |
| **NSIS-Setup (.exe)** | `target/release/bundle/nsis/OxidVault_1.0.0_x64-setup.exe` |
| **Portable EXE** | `target/release/oxidvault.exe` |

> **Pfad-Hinweis:** Cargo legt Artefakte im Workspace-Root unter `target/` ab (nicht unter `src-tauri/target/`).

> **Hinweis:** Der exakte MSI-Dateiname folgt dem Muster `{productName}_{version}_x64_{locale}.msi` aus `tauri.conf.json` (`productName`: `OxidVault`, `version`: `1.0.0`).

### App-Branding & Icons

| Aspekt | Detail |
|---|---|
| **Quell-Logo** | `logo.png` (Projektroot, quadratisch) |
| **Icon-Generierung** | `npm run icons` → `npx tauri icon logo.png` |
| **Bundle-Icons** | `src-tauri/icons/` — u. a. `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` |
| **tauri.conf.json** | `identifier`: `com.oxidvault.app` · `bundle.icon[]` verweist auf generierte PNG/ICO/ICNS |
| **Frontend-Logo** | `public/logo.png` (Kopie für Vite) · Komponente `AppLogo.tsx` |
| **UI-Platzierung** | Header (`Layout.tsx`), Welcome-Screen, Login/Unlock (`AuthForm`) |
| **Favicon** | `index.html` → `/logo.png` |

### Entwicklung

```bash
npm install          # Frontend-Abhängigkeiten
npm run icons        # Icons aus logo.png regenerieren
npm run tauri:dev    # Desktop-App im Dev-Modus (scripts/tauri-dev.ps1)
```

Siehe auch [Production (Release v1.0.0)](#production-release-v100) für den finalen Windows-Installer-Build.

### Voraussetzungen

| Tool | Mindestversion |
|---|---|
| Node.js | 20+ |
| Rust (stable) | 1.77+ |
| WebView2 (Windows) | System-abhängig |

### Self-Hosted-Betrieb

OxidVault ist **offline-first** konzipiert. Vault-Dateien (`.oxid`) liegen im Dateisystem des Betreibers. Für Team-Sync oder Backup über öffentliche Git-Server steht die **Git-Synchronisation** (Runde 4) zur Verfügung — die verschlüsselte `.oxid`-Datei kann sicher in jedem Git-Remote liegen.

---

## 10. Dokumentationspflicht & Changelog

### Pflicht zur Synchronisation

Bei folgenden Änderungen **muss** dieses Dokument im selben Commit / PR aktualisiert werden:

- [ ] Neue oder geänderte **Tauri Commands**
- [ ] Neue oder geänderte **Typen** (`VaultInfo`, Entry-Typen, etc.)
- [ ] **Dateiformat**-Änderungen (`.oxid` Header, Versionen)
- [ ] **Krypto-Parameter** (KDF, AEAD, Key-Rotation)
- [ ] **Verzeichnisstruktur** (neue Crates, Module, Plugins)
- [ ] **Architektur-Entscheidungen** (ADRs inline dokumentieren)

### Changelog

| Datum | Version | Änderung |
|---|---|---|
| 2025-06-19 | 0.1.0 | Initiales Projekt-Setup: Tauri v2, vault-core, React-Frontend, 4 Tauri Commands, Krypto-Spezifikation |
| 2025-06-19 | 0.1.0 | Vault-Persistenz: Argon2id + AES-256-GCM, `.oxid`-Format, 9 Tauri Commands, Secret-CRUD, UI-Flow |
| 2025-06-19 | 0.1.0 | Vault-Setup-Flows: Passwort → Speicherdialog (Create), Datei → Passwort (Open), deutsche Fehlermeldungen |
| 2025-06-19 | 0.1.0 | Master-Passwort-Richtlinie: min. 12 Zeichen, Blocklist, zxcvbn-Entropie (Frontend + Backend) |
| 2025-06-19 | 0.1.0 | Typisierte Secrets: web_login, ssh_key, api_token — Modal, Sidebar-Icons, Kopieren, AES-256-GCM Persistenz |
| 2025-06-19 | 0.1.0 | v0.1.0: Clipboard Auto-Clear (30s), Echtzeit-Suche (Titel/URL/Benutzer), `username` in Summary |
| 2025-06-19 | 0.1.0 | Passwort-Generator (CSPRNG, Ctrl+G), Auto-Lock (120s), RAM-Purge via zeroize |
| 2025-06-19 | 0.1.0 | Secret bearbeiten (`update_entry`), Generator-Feldübernahme in Formularen |
| 2025-06-19 | 0.1.0 | Theme-System: Oxid, Dracula, Nord, Matrix — CSS-Variablen + localStorage |
| 2025-06-19 | 0.1.0 | SSH Quick Connect: russh, xterm.js-Terminal, Event-Streaming, Key nur im RAM |
| 2025-06-19 | 0.1.0 | Enterprise Hardening: Atomic Writes (.oxid.tmp), Lock-on-Minimize |
| 2025-06-19 | 0.1.0 | Smart-Start: letzter Vault-Pfad in `settings.json`, `bootstrap_vault`, `attach_locked`, „Anderen Tresor öffnen“ |
| 2025-06-19 | 0.1.0 | Web-Login Quick Open: `open_website_url`, http(s)-Validierung, Button in EntryDetail |
| 2025-06-19 | 0.1.0 | Web-Login: Auto-`https://` für bare Domains (google.de), Scheme-Injection-Schutz bleibt |
| 2025-06-19 | 0.1.0 | Admin Secret-Typen: database, network_wifi, secure_note · Sidebar Quick-Actions |
| 2025-06-19 | 0.1.0 | Live-Ping: TCP-Reachability, 10s-Polling, Status-Punkte Sidebar + Detail |
| 2025-06-19 | 0.1.0 | Ordner & Tags: `folder`/`tags` auf Secrets, Sidebar-Filter, Ordner-Gruppierung |
| 2025-06-19 | 0.1.0 | Security Dashboard: `audit_vault_security`, Duplikat-/Schwäche-Analyse, Vault-Score |
| 2025-06-19 | 0.1.0 | Git-Sync: `sync_vault_git`, Settings `gitSync`, Header-Sync-Button, `Vault::reload_from_disk` |
| 2025-06-19 | 0.1.0 | Passwort-Ablauf: `expires_at`, `ExpiryBadge`, Security-Dashboard To-Do-Liste |
| 2025-06-19 | 0.1.0 | Dashboard-Kacheln als Sidebar-Filter: klickbare Metriken, `DashboardFilterBar` |
| 2025-06-19 | 1.0.0 | **Release:** Offizielles Branding (`logo.png`), Tauri-Icons, `AppLogo`, Version 1.0.0, MSI-Build-Doku |

---

*OxidVault — Built for admins who don't have time for slow tools.*
