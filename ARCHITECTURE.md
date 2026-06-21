# OxidVault — Technische Architektur

> **Single Source of Truth**  
> Dieses Dokument ist die zentrale Referenz für die technische Architektur von OxidVault.  
> Bei jeder Ergänzung von Kernfunktionen, Tauri Commands, Dateiformaten oder sicherheitsrelevanten Änderungen ist **ARCHITECTURE.md** synchron mit dem Code zu aktualisieren.

**Version:** 1.0.0 · **Stand:** 2025-06-19 (Native Messaging Phase 2)

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
10. [Browser-Erweiterung — Native Messaging (Phase 1–3)](#10-browser-erweiterung--native-messaging-phase-13)
11. [Audit-Logging & Compliance (ISO 27001)](#11-audit-logging--compliance-iso-27001)
12. [Vault-Persistenz: UNC-Pfade & Atomic Writes](#12-vault-persistenz-unc-pfade--atomic-writes)
13. [Zentrales Policy-Management & Admin-GPOs](#13-zentrales-policy-management--admin-gpos)
14. [Dokumentationspflicht & Changelog](#14-dokumentationspflicht--changelog)

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
| **Zero-Knowledge** | Der Master-Key und alle Secret-Payloads verbleiben im Rust-Kern. Plaintext-Secrets **dürfen standardmäßig nicht** über die Tauri-IPC-Bridge in den JavaScript-Heap (V8) gelangen — nur Metadaten, explizites `reveal_secret` oder OS-Clipboard via `copy_to_clipboard`. |
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
│  vault-core · argon2 · aes-gcm · zeroize · arboard · serde │
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
| **Rust** | stable (≥ 1.85) | Speichersichere Backend-Logik |
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
      │ Salt (pro Vault)      │ ZeroizeOnDrop on lock   │ Nonce (pro Blob, OsRng)
      ▼                       ▼                        ▼
  .oxid Header            Nie ans Frontend         Verschlüsselte Datei
```

**Garantien:**

- Das Master-Passwort wird **nicht** persistiert, geloggt oder an das Frontend übergeben.
- Eingehende Master-Passwörter in Tauri Commands werden sofort in **`zeroize::Zeroizing<String>`** gewrappt und nach der KDF-Nutzung überschrieben.
- Der Master-Key wird bei `lock_vault` via `zeroize` aus dem Speicher entfernt (`MasterKey`: `Zeroize` + `ZeroizeOnDrop`).
- Das Frontend kommuniziert ausschließlich über typisierte Tauri Commands — kein direkter Datei- oder Krypto-Zugriff.
- CSP in `tauri.conf.json` beschränkt Script- und Style-Quellen auf `'self'`.

#### IPC-Bridge & V8-Heap-Schutz (Enterprise Hardening — K4)

> **Status:** ✅ `SecretEntryPublic` · `reveal_secret` · `copy_to_clipboard` · `src-tauri/src/clipboard.rs`

Der **JavaScript-Heap (V8)** im WebView kann nicht deterministisch zeroisiert werden. OxidVault behandelt daher den React-Frontend-Speicher als **nicht vertrauenswürdig** für Secret-Plaintext:

| Regel | Umsetzung |
|---|---|
| **Kein Standard-IPC für Secrets** | `get_entry` liefert nur **`SecretEntryPublic`** — Metadaten (Titel, URL, Username, Host, …) ohne Passwort, Token, Private Key oder Notiz-Inhalt |
| **Reveal on Demand** | `reveal_secret(entry_id, field?)` — kurzlebiger Klartext + `warning`-String; Frontend muss Wert nach Anzeige verwerfen |
| **Clipboard nur via Rust** | `copy_to_clipboard(entry_id, field?)` — Secret wird im Rust-Kern entschlüsselt, via **`arboard`** in die OS-Zwischenablage geschrieben, **30 s Auto-Clear** durch Rust-Background-Thread |
| **Edit-Modus** | `NewSecretModal` lädt Secrets beim Öffnen per `reveal_secret` — temporär im Form-State, nicht in der Detail-IPC |

```
Detailansicht / Sidebar
        │
        ├── list_entries / get_entry ──► SecretEntrySummary / SecretEntryPublic
        │                                 (kein password, token, private_key, content)
        │
        ├── Anzeigen (Auge) ──► reveal_secret ──► kurzlebig im React-State
        │
        └── Kopieren ──► copy_to_clipboard ──► arboard (OS) ──► 30s Rust-Timer ──► Clear
```

**Warum Plaintext nicht standardmäßig ans Frontend darf:**

- Jede IPC-Serialisierung erzeugt `String`-Kopien im Rust- **und** JS-Heap ohne `ZeroizeOnDrop`.
- Garbage Collection in V8 gibt Speicherseiten nicht garantiert frei — Plaintext-Fragmente können lange verbleiben.
- DevTools, Browser-Extensions und Crash-Dumps im WebView-Kontext erhöhen das Angriffsfenster.

**Einschränkung (ehrlich dokumentiert):** `reveal_secret` und der Edit-Formular-Flow erzeugen unvermeidbar kurzlebige Plaintext-Kopien über IPC bzw. im React-State. Das Bedrohungsmodell minimiert Dauer und Häufigkeit — Clipboard und Bulk-Export laufen ausschließlich über Rust.

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

**Speicher-Härtung (K2):** Der Stack-Puffer für die KDF-Ausgabe wird als **`Zeroizing<[u8; 32]>`** gehalten — bei Erfolg **und** Fehler (Early Return via `?`) wird der Puffer beim Drop überschrieben, bevor er an `MasterKey` übergeben wird.

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
| **Nonce-Quelle** | `aes_gcm::aead::OsRng` — OS-CSPRNG, frisch pro `encrypt()`-Aufruf |
| **Auth-Tag** | 128 Bit (Standard GCM) |
| **AAD** | Optional: Vault-ID + Entry-ID als zusätzlich authentifizierte Metadaten (geplant) |

**Einsatzbereiche:**

- Vault-Datei-Body (Secret-Einträge, Notizen, Anhänge)
- Export-Bundles (optional passwortgeschützt mit separatem Ephemeral-Key)

**Implementierungsstatus:** ✅ Implementiert in `crates/vault-core/src/crypto.rs` (`encrypt` / `decrypt`).

| Funktion | Rückgabe / Verhalten |
|---|---|
| `encrypt(key, plaintext)` | Frische 12-Byte-Nonce + Ciphertext |
| `decrypt(key, nonce, ciphertext)` | **`Zeroizing<Vec<u8>>`** — Plaintext-Heap wird beim Drop überschrieben (K1) |
| Falsches Passwort | GCM-Auth-Fehler → `VaultError::InvalidPassword` (keine Unterscheidung auf API-Ebene) |

**Konsument:** `format.rs` deserialisiert aus `plaintext.as_ref()` und gibt `Zeroizing<Vec<u8>>` beim Scope-Ende frei.

### Speichersicherheit

| Maßnahme | Crate / Mechanismus |
|---|---|
| Schlüssel-Löschung bei Lock | `zeroize` + `ZeroizeOnDrop` auf `MasterKey` |
| Secret-Purge bei Lock | `SecretPayload::zeroize_secrets()` vor `entries.clear()` |
| **Plaintext-Heap nach Decrypt (K1)** | `decrypt()` → `Zeroizing<Vec<u8>>` in `crypto.rs` |
| **KDF-Stack-Puffer (K2)** | `Zeroizing<[u8; 32]>` in `derive_from_password` — alle Exit-Pfade |
| **Zero-Clone Persist (K3)** | `persist()` serialisiert `&self.entries` in-place — kein `entries.clone()` |
| **Serialisierungs-Puffer (K3)** | `serialize_entries_zeroizing()` in `format.rs` → `Zeroizing<Vec<u8>>` vor `encrypt` |
| **IPC ohne Secrets (K4)** | `get_entry` → `SecretEntryPublic`; Secrets nur via `reveal_secret` / `copy_to_clipboard` |
| **Eingehende Passwörter (K4)** | `Zeroizing<String>` in `create_vault`, `open_vault`, `unlock_vault` |
| **Atomic Writes** | Temp-Datei `.oxid.tmp` → `fsync` → `rename` (crash-safe) |
| **Lock-on-Minimize** | Tauri `WindowEvent::Focused(false)` + `is_minimized()` → sofortiger Lock |
| Kein Klartext in Logs | Kein `Debug`-Output für sensitive Structs (`MasterKey` ohne `Debug`) |
| Release-Härtung | `panic = "abort"`, `strip = true`, `LTO` |

#### Zeroizing im Krypto-Kern (K1 & K2)

> **Status:** ✅ `crates/vault-core/src/crypto.rs`

| Speicherort | Typ | Wann zeroisiert |
|---|---|---|
| KDF-Ausgabe (Stack) | `Zeroizing<[u8; 32]>` | Drop nach `hash_password_into` (Ok **und** Err) |
| Master-Key (Heap) | `MasterKey` mit `ZeroizeOnDrop` | `lock_vault` → `master_key = None` |
| Decrypt-Plaintext (Heap) | `Zeroizing<Vec<u8>>` | Nach Deserialisierung in `read_vault_file` |
| Persist-JSON (Heap) | `Zeroizing<Vec<u8>>` | Nach `encrypt()` in `write_vault_bytes` |
| Extract/Reveal (Rust) | `Zeroizing<String>` | Drop nach Clipboard-Write oder IPC-Serialisierung |

```
decrypt(ciphertext)
      │
      ▼
Zeroizing<Vec<u8>>  ──► serde_json::from_slice ──► VaultPayload
      │                                              (Strings im Vault-RAM)
      ▼
Drop → Heap überschrieben (K1)

derive_from_password(password)
      │
      ▼
Zeroizing<[u8; 32]> on stack ──► Ok(MasterKey) / Err(?)
      │
      ▼
Drop → Stack überschrieben (K2)
```

#### Zero-Clone-Policy beim Persistieren (K3)

> **Status:** ✅ `crates/vault-core/src/vault.rs` · `format.rs`

Früher kopierte `persist()` alle Einträge via `entries.clone()` — eine Deep-Copy aller `String`-Passwörter im RAM bei jedem Speichervorgang. Das widerspricht dem Zero-Knowledge-Versprechen (zusätzliche Plaintext-Fragmente außerhalb der autoritativen `entries`-Liste).

**Aktuelles Verhalten:**

```rust
// vault.rs — persist()
format::update_vault_file(path, &self.name, self.kdf, &salt, key, &self.entries)
//                                                                      ^^^^^^^^^^^^^
//                                                              Borrow, kein Clone
```

```rust
// format.rs
serialize_entries_zeroizing(entries: &[SecretEntry]) → Zeroizing<Vec<u8>>
crypto::encrypt(key, plaintext.as_ref())
// plaintext (Zeroizing) wird nach encrypt() dropped und überschrieben
```

| Aspekt | Detail |
|---|---|
| **Serialisierung** | `VaultPayloadRef { entries: &'a [SecretEntry] }` — serde serialisiert per Referenz |
| **Kein Deep-Clone** | Kein `.clone()` auf `entries`, Passwörter oder Payloads in `persist()` |
| **Plaintext-Lebensdauer** | JSON-Puffer existiert nur für die Dauer von `write_vault_bytes` |
| **Atomic Write** | `.oxid.tmp` → `fsync` → `rename` mit SMB-Fallback (Details: [§12](#12-vault-persistenz-unc-pfade--atomic-writes)) |

#### Atomic Writes (Enterprise Hardening)

> **Status:** ✅ `crates/vault-core/src/format.rs` · `atomic_write_vault()`  
> **Details:** [§12 Vault-Persistenz](#12-vault-persistenz-unc-pfade--atomic-writes)

Verhindert korrupte `.oxid`-Dateien bei Absturz, Stromausfall oder SMB-Locking während des Speicherns:

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

| Aspekt | Detail |
|---|---|
| **Temp-Datei** | `{dir}/{name}.oxid.tmp` — **zwingend** im selben Verzeichnis wie die Zieldatei (UNC/SMB) |
| **Sync (Temp)** | `File::sync_all()` nach Schreiben — Daten auf Platte/Share |
| **Rename** | `std::fs::rename` — atomares Ersetzen auf lokalem FS und gleichem Share |
| **SMB-Fallback** | `OpenOptions` (truncate) → `std::io::copy` → `sync_all` auf Zieldatei → Temp löschen |
| **UNC-Pfade** | `path_util::normalize_vault_path` in `vault.rs` (Create/Open/Attach) |
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
| **Clipboard (Backend)** | `SecureClipboard::cancel_pending()` bei `perform_lock()` |

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

### Clipboard Auto-Clear (v1.0.0 — Security-Härtung K4)

> **Status:** ✅ Rust: `src-tauri/src/clipboard.rs` (`arboard`) · Frontend-Toast: `src/lib/secureClipboard.ts`

OxidVault behandelt die System-Zwischenablage als **ephemeren Kanal**. Secrets werden **nicht** mehr über `navigator.clipboard` aus dem Frontend kopiert — der Rust-Kern schreibt direkt ins OS.

| Parameter | Wert |
|---|---|
| **Auto-Clear-Delay** | 30 Sekunden (exakt) |
| **Schreiben** | Rust-Crate **`arboard`** (native OS-Clipboard) |
| **Timer** | `std::thread::spawn` + `sleep(30s)` — unabhängig vom JS-Event-Loop |
| **Clear-Strategie** | `get_text()` === gespeichertes Secret → `set_text("")` |
| **Generation-Counter** | Neuer Kopiervorgang invalidiert ältere Clear-Timer |
| **Abbruch bei Lock** | `SecureClipboard::cancel_pending()` in `perform_lock()` |

**UX-Feedback (Frontend):**

- Nach `copy_to_clipboard`: `notifyBackendSecureCopy()` startet Countdown-UI (Toast + Button-Label)
- Button-Label: `Kopiert! (29s)` … Countdown bis Clear
- Toast (`ClipboardToast`): „In Zwischenablage kopiert — wird in Xs automatisch geleert“
- **Usernames / URLs** (nicht geheim): weiterhin Frontend-`navigator.clipboard` via `useSecureCopy().copy()`

**Ablauf (Secret-Kopieren):**

```
Frontend: copy_to_clipboard(entry_id, field?)
        │
        ▼
Rust: Vault::extract_secret → Zeroizing<String>
        │
        ▼
arboard::Clipboard::set_text(secret)
        │
        ▼
Background-Thread: sleep(30s) → Clear wenn unverändert
        │
        ▼
Frontend: notifyBackendSecureCopy() → Toast-Countdown
        │
        ▼
Bei lock_vault: cancel_pending() — Timer wird invalidiert
```

**Legacy-Hinweis:** `copySecureToClipboard()` in `secureClipboard.ts` bleibt für **nicht-sensitive** Felder (Benutzername). Passwörter, Tokens und Keys nutzen ausschließlich `copy_to_clipboard`.

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
│           ├── lock.rs      ← exklusiver Vault-Datei-Lock
│           ├── policy/      ← Master-Passwort-Regeln + Admin-GPO (`policy.json`)
│           ├── entry.rs     ← SecretEntry, SecretEntryPublic, SecretField
│           ├── vault.rs     ← Vault-Lifecycle, Persistenz
│           ├── policy.rs    ← Master-Passwort-Richtlinie
│           ├── generator.rs ← CSPRNG Passwort-Generator
│           ├── audit.rs          ← ISO-27001 Compliance-Log (append-only, hash chain)
│           ├── security_audit.rs ← Offline Security Audit (Duplikate, Schwäche, Score)
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
│   │   └── useSecureCopy.ts  ← copySecret → copy_to_clipboard IPC
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
│       ├── main.rs          ← Binary-Einstiegspunkt (--native-messaging → Headless)
│       ├── lib.rs           ← Tauri Builder, Plugin-Init, State
│       ├── native_messaging.rs ← Chrome/Firefox Native Messaging Host (stdio)
│       ├── clipboard.rs     ← SecureClipboard (arboard, 30s Auto-Clear)
│       ├── probe/           ← Async TCP-Reachability-Checks
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
├── browser-extension/       ← ★ Browser-Erweiterung (Phase 2: MV3 + Background)
│   ├── manifest.json        ← Manifest V3 (nativeMessaging)
│   ├── background.js        ← connectNative, Ping beim Start
│   ├── README.md            ← 3-Schritte E2E-Anleitung (Ping/Pong)
│   └── host/
│       └── com.oxidvault.app.json  ← Native-Host-Manifest (via PS-Skript)
│
├── scripts/
│   ├── register_native_host.ps1   ← Registry + Host-Manifest (Chrome/Edge)
│   ├── tauri-dev.ps1
│   ├── tauri-build.ps1
│   └── generate-icons.mjs
│
├── public/                  ← Statische Assets (SVG, etc.)
└── dist/                    ← Vite-Production-Build (generiert)
```

### Verantwortungstrennung

| Schicht | Pfad | Darf wissen / tun |
|---|---|---|
| **Frontend** | `src/` | UI rendern, Shortcuts, IPC-Aufrufe — **kein Plaintext-Secret-State by default** |
| **IPC** | `src/lib/ipc.ts` ↔ `src-tauri/src/commands/` | Typisierte Request/Response-Grenze; Secrets nur via `reveal_secret` / `copy_to_clipboard` |
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
3. `vault-core` erstellt `SecretEntry`, serialisiert Payload als JSON (in `Zeroizing<Vec<u8>>`).
4. Payload wird mit AES-256-GCM verschlüsselt und atomar in die `.oxid`-Datei geschrieben (`persist()` ohne `entries.clone()`).
5. Frontend erhält nur `SecretEntrySummary` (ohne Secret-Felder).

### Datenfluss: Secret bearbeiten (Data Mutation)

1. User wählt Eintrag in der Sidebar → `EntryDetail` zeigt **Metadaten** via `get_entry` (`SecretEntryPublic`).
2. Klick auf **Bearbeiten** → `NewSecretModal` lädt Secrets per **`reveal_secret`** (kurzlebig im Form-State).
3. User passt Felder an (optional: Passwort-Generator → direkte Feldübernahme).
4. Frontend ruft `update_entry({ id, input })` auf — Secrets fließen **in** den Rust-Kern (Eingabe, nicht Listen-IPC).
5. `vault-core::Vault::update_entry`:
   - Validiert Eingabe, prüft unveränderten Eintragstyp
   - Behält `id` + `created_at`, setzt `updated_at` neu
   - Ersetzt Eintrag im RAM, ruft `persist()` auf (Borrow, kein Clone)
6. Gesamter Vault-Body wird AES-256-GCM neu verschlüsselt und in `.oxid` geschrieben.
7. Frontend aktualisiert Sidebar (`list_entries`) und Detailansicht (`get_entry` → Public).

```
Bearbeiten → reveal_secret (Form) → update_entry → persist(&entries) → AES-256-GCM → .oxid
                              ↓
                    list_entries + get_entry (Public) → Sidebar + Detail refresh
```

### Datenfluss: SSH Quick Connect

> **Status:** ✅ `russh` · `src-tauri/src/ssh/` · `SshTerminalModal` (xterm.js)

```
Quick Connect (entry_id)
        │
        ▼
ssh_connect ──► Vault::extract_ssh_credentials(id)  [Key bleibt im Rust-RAM]
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
| **SSH-Crate** | `russh` 0.61+ (`ring`-Feature, kein `rsa` in Dependency-Tree) |
| **Credentials** | `Vault::extract_ssh_credentials` — Private Key **nie** ans Frontend |
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
5. `VaultInfo` kehrt ans Frontend zurück — Secret-Metadaten über `get_entry` (Public); Klartext nur via `reveal_secret` / Clipboard via `copy_to_clipboard`.

---

## 6. API-Schnittstellen (Tauri Commands)

> Alle Commands sind synchron, laufen im Rust-Backend und geben `Result<T, String>` zurück.

| Command | Parameter | Rückgabe | Beschreibung | Status |
|---|---|---|---|---|
| `health_check` | — | `String` | Backend-Liveness-Probe (`"ok"`) | ✅ |
| `get_vault_info` | — | `VaultInfo` | Metadaten des aktuellen Vaults | ✅ |
| `bootstrap_vault` | — | `VaultInfo` | App-Start: gespeicherten Vault-Pfad laden (falls Datei existiert) | ✅ |
| `detach_vault` | — | `()` | In-Memory-Vault zurücksetzen (für „Anderen Tresor öffnen“) | ✅ |
| `create_vault` | `path`, `name`, `password` | `VaultInfo` | Neue `.oxid`-Datei; Passwort → `Zeroizing<String>` | ✅ |
| `open_vault` | `path`, `password` | `VaultInfo` | `.oxid` öffnen; Passwort → `Zeroizing<String>` | ✅ |
| `unlock_vault` | `password` | `VaultInfo` | Re-Unlock; Passwort → `Zeroizing<String>` | ✅ |
| `lock_vault` | — | `VaultInfo` | RAM-Purge + Clipboard-Timer abbrechen | ✅ |
| `list_entries` | — | `SecretEntrySummary[]` | Eintragsliste ohne Secrets | ✅ |
| `add_entry` | `input: SecretEntryInput` | `SecretEntrySummary` | Secret hinzufügen und Vault persistieren | ✅ |
| `update_entry` | `id`, `input: SecretEntryInput` | `SecretEntrySummary` | Secret aktualisieren und persistieren (Zero-Clone) | ✅ |
| `get_entry` | `id: String` | `SecretEntryPublic` | Metadaten ohne Klartext-Secrets | ✅ |
| `reveal_secret` | `entry_id`, `field?` | `RevealedSecret` | Kurzlebiger Klartext + Warnung | ✅ |
| `copy_to_clipboard` | `entry_id`, `field?` | `()` | OS-Clipboard via `arboard`, 30s Rust-Clear | ✅ |
| `generate_password_cmd` | `options: PasswordGenOptions` | `String` | CSPRNG-Passwort generieren (kein Vault nötig) | ✅ |
| `open_website_url` | `url: String` | `()` | Validierte http(s)-URL im Standard-Browser öffnen | ✅ |
| `check_entries_reachability` | `entry_ids: String[]` | `EntryReachabilityStatus[]` | Async TCP-Reachability für Infrastruktur-Einträge | ✅ |
| `audit_vault_security` | — | `SecurityAuditReport` | Offline-Passwort-Audit (Duplikate, Schwäche, Score) | ✅ |
| `get_audit_logs` | `limit: usize` | `AuditLogEntry[]` | Neueste Compliance-Audit-Einträge aus `{vault}.audit.log` (neueste zuerst) | ✅ |
| `get_app_settings` | — | `AppSettings` | Lokale App-Einstellungen laden | ✅ |
| `get_resolved_config` | — | `ResolvedConfig` | Effektive Policy (User + Admin-GPO, UI-`disabled`) | ✅ |
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

#### Secret-Typen (`SecretPayload` — on-disk / Rust-RAM)

> **Status:** ✅ Implementiert in `crates/vault-core/src/entry.rs`  
> Serialisierung als **internally-tagged JSON** mit `"type"`-Feld (flach in `SecretEntry` via `#[serde(flatten)]`).  
> **IPC-Hinweis:** Über Tauri wird **`SecretEntryPublic`** / **`SecretPayloadPublic`** ausgeliefert — sensitive Felder durch `has_password`, `has_token`, … ersetzt.

| `type` | Label | Pflichtfelder (Vault-RAM) | IPC-Public (Frontend) |
|---|---|---|---|
| `web_login` | Web-Login | `url`, `username`, `password` | `url`, `username`, `has_password`, `has_notes` |
| `ssh_key` | SSH-Key | `host`, `username`, `private_key` | `host`, `username`, `has_private_key`, `has_passphrase` |
| `api_token` | API-Token | `service`, `token` | `service`, `has_token` |
| `database` | Datenbank | `host`, `port`, …, `password` | Metadaten + `has_password` |
| `network_wifi` | Netzwerk / WLAN | `ssid`, `encryption_type`, `password` | `ssid`, `encryption_type`, `has_password` |
| `secure_note` | Sichere Notiz | `content` | `preview?`, `has_content` |

#### `SecretField` (Reveal / Clipboard)

| Wert | Verwendung |
|---|---|
| `primary` | Standard-Secret des Eintragstyps (Default für `reveal_secret` / `copy_to_clipboard`) |
| `password` | Web-Login, DB, WLAN |
| `token` | API-Token |
| `private_key` | SSH Private Key |
| `passphrase` | SSH Passphrase |
| `content` | Sichere Notiz |
| `notes` | Web-Login Notizen (sensibel — nicht in Public-IPC) |

#### `RevealedSecret`

```json
{
  "value": "…",
  "warning": "Dieser Wert wurde kurzzeitig entschlüsselt. …"
}
```

#### Secret-Typen — Beispiele on-disk (`SecretPayload`)

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
| **Audit-Backend** | `security_audit.rs` + `expiry.rs` — `expiring_entries` mit `status`: `expired` \| `expiring_soon` |

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

> **Status:** ✅ `audit_vault_security` · `vault-core/security_audit.rs` · `SecurityDashboard.tsx`

| Aspekt | Detail |
|---|---|
| **Navigation** | Sidebar-Tabs **Secrets** / **Security** / **Aktivität** oben in der linken Leiste |
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
| `web_login` | **⎘** Passwort kopieren (`copy_to_clipboard`, Rust/arboard) · **↗** Website öffnen (`open_website_url`, URL aus `subtitle`) |
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
| `SecretEntryInput` + `SecretPayload` | Eingabe via `add_entry` / `update_entry` (Secrets **in** Rust) |
| `SecretEntrySummary` | Sidebar-Liste, Rückgabe von `add_entry` / `update_entry` |
| `SecretEntryPublic` + `SecretPayloadPublic` | Detailansicht via `get_entry` — **ohne Klartext-Secrets** |
| `RevealedSecret` | Kurzzeit-Anzeige via `reveal_secret` |
| `SecretField` | Feld-Auswahl für `reveal_secret` / `copy_to_clipboard` |

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
| `getEntry(id)` | `get_entry` → `SecretEntryPublic` |
| `revealSecret(entryId, field?)` | `reveal_secret` |
| `copyToClipboard(entryId, field?)` | `copy_to_clipboard` |
| `generatePassword(options)` | `generate_password_cmd` |
| `openWebsiteUrl(url)` | `open_website_url` |
| `checkEntriesReachability(entryIds)` | `check_entries_reachability` |
| `auditVaultSecurity()` | `audit_vault_security` |
| `getAuditLogs(limit)` | `get_audit_logs` |
| `getAppSettings()` | `get_app_settings` |
| `getResolvedConfig()` | `get_resolved_config` |
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
   - Leerer Vault-Body (`&[]`) serialisiert → `Zeroizing<Vec<u8>>` → AES-256-GCM → Datei schreiben
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
| `EntryDetail` | `src/components/EntryDetail.tsx` | Metadaten + `SecureField` (reveal/copy via Rust-IPC) |
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
| Rust (stable) | 1.85+ |
| WebView2 (Windows) | System-abhängig |

### Self-Hosted-Betrieb

OxidVault ist **offline-first** konzipiert. Vault-Dateien (`.oxid`) liegen im Dateisystem des Betreibers. Für Team-Sync oder Backup über öffentliche Git-Server steht die **Git-Synchronisation** (Runde 4) zur Verfügung — die verschlüsselte `.oxid`-Datei kann sicher in jedem Git-Remote liegen.

Siehe auch [Browser-Erweiterung — Native Messaging (Phase 1–2)](#10-browser-erweiterung--native-messaging-phase-12) für die Headless-Registrierung und den Ping/Pong-E2E-Test.

---

## 10. Browser-Erweiterung — Native Messaging (Phase 1–3)

> **Status:** ✅ Phase 1 — Headless-Host, stdio-Protokoll, Dummy-Handler (`ping` → `pong`)  
> **Status:** ✅ Phase 2 — Manifest-V3-Extension, `background.js`, Registry-Skript, E2E-Anleitung  
> **Status:** ✅ Phase 3 — `content.js` AutoFill-Chamäleon, `get_login` Least-Privilege, localhost-IPC zur GUI  
> **Stil:** RoboForm-ähnlich — Browser-Erweiterung kommuniziert mit der Desktop-App über Native Messaging, nicht über Tauri-IPC.

> **Schnellstart (Ping/Pong):** Exakte 3-Schritte-Anleitung in [`browser-extension/README.md`](browser-extension/README.md).

### Ziel

Die Browser-Erweiterung (spätere Phasen) soll Formular-Autofill und Vault-Integration im Browser ermöglichen. Phase 1 legt die **Backend-Schnittstelle** in Rust: ein headless Prozess ohne WebView, der über stdin/stdout mit Chrome/Firefox spricht.

### CLI-Flag: `--native-messaging`

| Modus | Start | Verhalten |
|---|---|---|
| **Normal** | `oxidvault.exe` (GUI) | Tauri-Fenster, WebView, volle Desktop-App |
| **Headless** | `oxidvault-nmh.exe` (empfohlen, Windows) oder `oxidvault.exe --native-messaging` | Kein Fenster, kein Tauri-Builder — nur Native-Messaging-Loop |

Unter Windows muss das Host-Manifest auf **`oxidvault-nmh.exe`** zeigen: die Release-GUI (`oxidvault.exe`) wird mit `windows_subsystem = "windows"` gebaut; Chrome/Edge können dann stdout-Antworten nicht zuverlässig empfangen (Ping wird gesendet, kein `pong` in der Konsole).

Der Einstiegspunkt in `src-tauri/src/main.rs` prüft `std::env::args()` **vor** `oxidvault_lib::run()`. Bei `--native-messaging` wird `run_native_messaging()` aufgerufen und der Prozess beendet sich nach Pipe-EOF.

```rust
// main.rs (vereinfacht)
if args.contains("--native-messaging") {
    oxidvault_lib::run_native_messaging()?;
    return;
}
oxidvault_lib::run();
```

### Architektur

```mermaid
flowchart LR
    subgraph Browser["Browser (Chrome / Edge)"]
        CS[content.js]
        BG[background.js]
        CS -->|"hostname"| BG
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

| Komponente | Pfad | Verantwortung |
|---|---|---|
| **Binary-Einstieg** | `src-tauri/src/main.rs` | CLI-Abzweigung (GUI) |
| **NM-Host-Binary** | `src-tauri/src/bin/native_messaging_main.rs` | Console-`oxidvault-nmh.exe` für Browser-stdio (Windows) |
| **Public API** | `src-tauri/src/lib.rs` | `run_native_messaging()` |
| **Protokoll-Loop** | `src-tauri/src/native_messaging.rs` | Lesen/Schreiben, JSON-Dispatch (`ping`, `get_login`) |
| **IPC-Brücke (GUI)** | `src-tauri/src/nm_bridge/` | localhost TCP, Session-Token, Vault-Zugriff |
| **URL-Matching** | `crates/vault-core/src/url_match.rs` | Host/Substring-Score für Web-Logins |
| **Extension (MV3)** | `browser-extension/manifest.json` | `nativeMessaging`, Service Worker, `content_scripts` |
| **Background** | `browser-extension/background.js` | `connectNative`, `get_login`-Relay |
| **Content Script** | `browser-extension/content.js` | Login-Formular-Erkennung, AutoFill |
| **Host-Manifest** | `browser-extension/host/com.oxidvault.app.json` | Browser-Registrierung (Pfad + `allowed_origins`) |
| **Registry-Skript** | `scripts/register_native_host.ps1` | Schreibt Host-Manifest + HKCU Chrome/Edge |

### Native-Messaging-Protokoll (stdio)

Chrome und Firefox verwenden dasselbe Framing für `type: "stdio"`:

1. **Eingehend:** 4 Bytes **Little-Endian** `u32` = Payload-Länge in Bytes, danach UTF-8-JSON.
2. **Ausgehend:** identisches Format auf **stdout**.
3. **stdout ist reserviert** — kein `println!`, kein Logging auf stdout im Headless-Modus (würde das Protokoll zerstören). Fehler → `eprintln!` auf stderr.

**Schutzgrenzen (Phase 1):**

| Grenze | Wert | Zweck |
|---|---|---|
| `MAX_MESSAGE_LEN` | 1 MiB | DoS-Schutz bei fehlerhaftem Längen-Header |

### Phase-1/2-Nachrichten

| Request (JSON) | Response (JSON) |
|---|---|
| `{ "action": "ping" }` | `{ "status": "pong" }` |
| `{ "action": "get_login", "url": "<hostname>" }` | siehe Phase 3 |
| Unbekannte `action` | `{ "status": "error", "error": "unknown action" }` |
| Ungültiges JSON | `{ "status": "error", "error": "invalid json: …" }` |

### Phase 3 — `get_login` (Least Privilege)

**Ablauf:**

1. **`content.js`** (matches `<all_urls>`): erkennt `input[type=password]`, liest `window.location.hostname`, sendet `{ type: "GET_LOGIN", hostname }` an den Service Worker.
2. **`background.js`**: leitet `{ "action": "get_login", "url": "<hostname>" }` über Native Messaging an `oxidvault-nmh.exe` weiter.
3. **`native_messaging.rs`**: leitet die Anfrage per localhost-IPC an die laufende GUI (`nm_bridge/server.rs`) weiter — **nur** wenn OxidVault Desktop aktiv ist.
4. **`Vault::find_web_login_for_hostname`**: durchsucht entsperrte Web-Logins (`url_match.rs`: exakter Host > Subdomain > Substring), extrahiert Passwort via `extract_secret` (`Zeroizing`).
5. Antwort zurück zur Extension; **`content.js`** füllt User-/Passwort-Felder nur bei `{ "status": "ok" }`.

**Antworten `get_login`:**

| Status | Bedeutung |
|---|---|
| `ok` | `{ "status": "ok", "username": "…", "password": "…" }` — genau ein passender Eintrag |
| `not_found` | Kein Web-Login für diese Domain |
| `locked` | Vault gesperrt — Desktop-App entsperren |
| `unavailable` | Desktop-App nicht gestartet / IPC nicht erreichbar |
| `error` | Protokoll- oder Autorisierungsfehler |

**Sicherheit:**

- NM-Host-Prozess hat **keinen** eigenen Vault — Zugriff nur über GUI-Prozess mit entsperrtem `AppState`.
- Session-Datei `%APPDATA%/com.oxidvault.app/native_messaging_session.json` enthält Port + Token (127.0.0.1 only).
- Passwörter in Rust via `Zeroizing<String>` bis zur JSON-Serialisierung; Extension füllt Felder, speichert nicht dauerhaft.

### Host-Manifest

Datei: `browser-extension/host/com.oxidvault.app.json`

```json
{
  "name": "com.oxidvault.app",
  "description": "OxidVault Native Messaging Host (Phase 1 — ping/pong)",
  "path": "C:\\Path\\To\\oxidvault-nmh.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID_HERE/"]
}
```

| Feld | Hinweis |
|---|---|
| `name` | Muss mit Registry-/Manifest-Schlüssel übereinstimmen (`com.oxidvault.app`) |
| `path` | Absoluter Pfad zu `target/release/oxidvault-nmh.exe` (Console-Binary; `register_native_host.ps1` setzt dies automatisch) |
| `args` | Entfällt bei `oxidvault-nmh.exe` (dedizierter Einstieg). Legacy: `oxidvault.exe` mit `["--native-messaging"]` |
| `allowed_origins` | Extension-ID der WebExtension — wird von `register_native_host.ps1` gesetzt |

### Phase 2 — Extension-Skeleton & Registry-Skript

**Extension (`browser-extension/`):**

- `manifest.json` — Manifest V3, Permission `nativeMessaging`, Background Service Worker
- `background.js` — beim Start: `chrome.runtime.connectNative("com.oxidvault.app")`, `postMessage({ action: "ping" })`, Listener für `onMessage` / `onDisconnect`, Ausgabe per `console.log`

**Registry-Skript (`scripts/register_native_host.ps1`):**

```powershell
.\scripts\register_native_host.ps1 -ExtensionId "<32-Zeichen-ID von chrome://extensions>"
```

| Aktion | Detail |
|---|---|
| Binary-Pfad | Schreibt absoluten Pfad zu `target/release/oxidvault-nmh.exe` in `com.oxidvault.app.json` |
| `allowed_origins` | Setzt `chrome-extension://<ExtensionId>/` |
| Registry Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.oxidvault.app` → Pfad zur JSON |
| Registry Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.oxidvault.app` → Pfad zur JSON |

Optional: `-BuildProfile debug` für `target/debug/oxidvault-nmh.exe`.

### Ping/Pong E2E-Test (3 Schritte)

1. **Binary bauen:** `cargo build --release`
2. **Extension laden:** `chrome://extensions` → Entwicklermodus → Entpackte Erweiterung → Ordner `browser-extension` → Extension-ID kopieren
3. **Host registrieren:** `.\scripts\register_native_host.ps1 -ExtensionId "<ID>"` → Extension neu laden → Service-Worker-Konsole: `{ status: "pong" }`

Details und Fehlerbehebung: [`browser-extension/README.md`](browser-extension/README.md).

### Registrierung (Windows, manuell)

**Chrome** — Registry (HKCU):

```
Software\Google\Chrome\NativeMessagingHosts\com.oxidvault.app
  (Default) = Vollständiger Pfad zu com.oxidvault.app.json
```

**Firefox** — Registry (HKCU):

```
Software\Mozilla\NativeMessagingHosts\com.oxidvault.app
  (Default) = Vollständiger Pfad zu com.oxidvault.app.json
```

Nach Anpassung von `path` und `allowed_origins` kann die Extension `chrome.runtime.connectNative("com.oxidvault.app")` bzw. Firefox-Äquivalent nutzen.

### Manueller Test (ohne Extension)

PowerShell (Payload-Länge + JSON an stdin pipen):

```powershell
$json = '{"action":"ping"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$len = [BitConverter]::GetBytes([uint32]$bytes.Length)
$input = $len + $bytes
$input | & ".\target\release\oxidvault.exe" --native-messaging
```

Erwartete stdout-Antwort (hex-dekodiert): 4-Byte-Länge + `{"status":"pong"}`.

---

## 11. Audit-Logging & Compliance (ISO 27001)

> **Status:** ✅ Append-only Compliance-Log · metadata-only · SHA-256 Hash-Kette  
> **Modul:** `crates/vault-core/src/audit.rs`  
> **Passwort-Schwäche-Dashboard:** weiterhin `crates/vault-core/src/security_audit.rs` (getrenntes Modul)

### Ziel

Revisionssichere Protokollierung sicherheitsrelevanter Vault-Events für ISO-27001-konforme Nachvollziehbarkeit — **ohne** Klartext-Secrets im Log.

### Datenschutz-Regeln (strikte API)

| Regel | Umsetzung |
|---|---|
| **Keine Secrets im Log** | [`AuditAction`](crates/vault-core/src/audit.rs) ist ein Enum — nur Metadaten-Events, kein `String`-Passwort/Key-Parameter |
| **Nur Entry-Referenz** | Optional `entry_id` (UUID), nie Inhalt |
| **Trait-Anbindung** | [`AuditLog::log`](crates/vault-core/src/audit.rs) — `Vault` ruft intern `audit_logger.log(...)` auf |

### AuditAction (Metadaten-Events)

| Variante | Auslöser |
|---|---|
| `VaultCreated` | `Vault::create` |
| `VaultOpened` | `Vault::open` |
| `VaultUnlocked` | `Vault::unlock` (mit Lock-ID als `entry_id`) |
| `VaultLocked` | `Vault::lock` |
| `EntryCreated` | `Vault::add_entry` |
| `EntryUpdated` | `Vault::update_entry` |
| `SecretRevealed` | `Vault::reveal_secret` |
| `SecretCopied` | Tauri `copy_to_clipboard` → `Vault::record_audit` |

### Speicherformat

| Aspekt | Detail |
|---|---|
| **Datei** | `{vault}.audit.log` neben `{vault}.oxid` (z. B. `team.oxid` → `team.audit.log`) |
| **Schreibmodus** | `OpenOptions::append(true).create(true)` — append-only |
| **Zeitstempel** | ISO-8601 UTC (`2025-06-20T21:00:00.123Z`) |
| **Zeilenformat** | `[TIMESTAMP] [ACTION] [ENTRY_ID] prev_hash=… entry_hash=…` |
| **ENTRY_ID** | UUID oder `-` wenn kein Eintrag betroffen |

**Beispiel:**

```text
[2025-06-20T21:00:00.123Z] [VaultUnlocked] [-] prev_hash=000…000 entry_hash=a1b2…
[2025-06-20T21:00:01.456Z] [EntryCreated] [550e8400-e29b-41d4-a716-446655440000] prev_hash=a1b2… entry_hash=c3d4…
```

### OS-Level Zugriffsschutz (ACLs / Permissions)

| Plattform | Schutz | Details |
|---|---|---|
| **Windows** | Explizite DACL | Beim Erstellen/Öffnen von `{vault}.audit.log`: Zugriff nur für **aktuellen Windows-Benutzer** und **Administrators** (`S-1-5-32-544`); `Everyone`/`Guests` werden entfernt; DACL **protected** (keine Vererbung) |
| **Linux / macOS** | `chmod 0o600` | Read/Write ausschließlich für den Datei-Owner via `std::os::unix::fs::PermissionsExt` |
| **Startup** | `audit::init()` | Wird in `src-tauri/src/main.rs` vor App-Start aufgerufen; Self-Test mit Temp-Datei — **Abbruch mit Fehlermeldung**, wenn OS-Schutz nicht durchsetzbar ist |
| **Vault-Bindung** | `AuditLogger::for_vault` | Jede `{vault}.audit.log` wird beim Binden erneut abgesichert (`audit_secure::secure_audit_log_file`) |

Die **Integrität der Audit-Logs** (Hash-Kette) setzt voraus, dass Unbefugte die Datei nicht lesen oder manipulieren können — daher ist der OS-Level-Schutz Teil der ISO-27001-Compliance.

**Modul:** `crates/vault-core/src/audit_secure.rs`

### Integrität (Hash-Kette)

Jeder Eintrag enthält:

1. **`prev_hash`** — SHA-256 des vorherigen Eintrags (Genesis: 64× `0`)
2. **`entry_hash`** — SHA-256 über den Record-String `[TIMESTAMP] [ACTION] [ENTRY_ID] prev_hash=…`

Manipulation bricht die Kette; Verifikation via `verify_audit_chain(path)`.

### Integration in `Vault`

```rust
// vault.rs (vereinfacht)
self.audit_logger.log(AuditAction::EntryCreated, Some(&summary.id))?;
```

Öffentliche API für Commands: `Vault::record_audit(action, entry_id)`.

### UI-Visualisierung (Aktivitäts-Log)

> **Status:** ✅ `get_audit_logs` · `AuditLogTable.tsx` · Sidebar-Tab **Aktivität**

| Aspekt | Detail |
|---|---|
| **Navigation** | Sidebar-Tabs **Secrets** / **Security** / **Aktivität** |
| **Command** | `get_audit_logs(limit)` — liest `{vault}.audit.log`, parst Zeilenformat, liefert neueste `limit` Einträge (neueste zuerst) |
| **Typ** | `AuditLogEntry`: `timestampUtc`, `action`, `entryId`, `entryHash` — **keine Secrets** |
| **Parser** | `vault-core::read_audit_logs(vault_path, limit)` |
| **Zeitstempel** | UTC im Log → lokale Systemzeit im UI (`toLocaleString`) |
| **Aktionen** | Technische `AuditAction`-Enums → deutsche Beschreibungstexte (`auditLogLabels.ts`) |
| **Suche** | Clientseitiger Filter nach Aktion, Eintrag-ID, Hash, formatiertem Zeitstempel |
| **Sicherheitshinweis** | Info-Banner: keine Passwörter oder Benutzernamen im Log |

---

## 12. Vault-Persistenz: UNC-Pfade & Atomic Writes

> **Status:** ✅ `crates/vault-core/src/format.rs` · `crates/vault-core/src/path_util.rs` · `vault.rs`  
> **Ziel:** Crash-safe Persistenz auf lokalen Laufwerken **und** UNC-Netzwerkfreigaben (`\\server\share\...`)

### UNC-Pfad-Handling

| Aspekt | Umsetzung |
|---|---|
| **Modul** | `path_util::normalize_vault_path` |
| **Windows UNC** | Erhält `\\server\share\...`; normalisiert `//server/share` → `\\server\share` |
| **Integration** | `Vault::create`, `Vault::open`, `Vault::attach_locked` normalisieren vor FS-Zugriff |
| **PathBuf** | Standard-Rust-`Path`/`PathBuf` — kein String-Hacking für Temp-Dateien |

**Beispiel:**

```text
\\fileserver\team\vault.oxid
  → Temp: \\fileserver\team\vault.oxid.tmp   (gleicher Share)
```

### Robuster Schreibprozess (`atomic_write_vault`)

| Schritt | Aktion | Zweck |
|---|---|---|
| **A** | Temp-Datei `{dir}/{name}.oxid.tmp` im **selben Verzeichnis** schreiben | Atomares `rename` erfordert gleiches Volume/Share |
| **B** | `sync_all()` auf Temp-Datei | Daten physisch auf Platte/Share |
| **C** | `std::fs::rename(temp → target)` | Atomares Ersetzen (lokal + gleicher SMB-Share) |
| **D** | **Fallback** bei Rename-Fehler (z. B. SMB-Locking): Zieldatei öffnen (write/truncate) → `std::io::copy` → `sync_all()` → Temp löschen | Robustheit auf Netzwerkfreigaben |

```
write_vault_bytes(.tmp) ──sync──► rename(.tmp → .oxid) ──OK──► fertig
                                      │
                                   Fehler
                                      │
                                      ▼
                         copy(.tmp → .oxid) ──sync(.oxid)──► remove(.tmp)
```

| Fehlerfall | Verhalten |
|---|---|
| Schreiben/Sync der Temp-Datei fehlgeschlagen | Temp wird gelöscht; Original unverändert |
| Rename fehlgeschlagen, Copy+Sync erfolgreich | Zieldatei aktualisiert; Temp entfernt |
| Copy/Sync fehlgeschlagen | Temp wird gelöscht; Fehler wird propagiert |

### Compliance-Hinweis

Der SMB-Fallback (Schritt D) ist bewusst **nicht** atomar auf Dateiebene — er greift nur, wenn `rename` am Share scheitert. Schritt A–C bleiben der bevorzugte Pfad für Integrität; Schritt D verhindert Datenverlust bei SMB-Locks.

### Exklusiver Vault-Datei-Lock (`lock.rs`)

> **Status:** ✅ `crates/vault-core/src/lock.rs` · `Vault::open()` · `Vault::close()` · `Drop`

Verhindert gleichzeitiges Öffnen/Schreiben derselben `.oxid`-Datei durch mehrere Prozesse (lokal oder auf UNC-Shares):

| Aspekt | Detail |
|---|---|
| **Lock-Datei** | `{vault}.lock` neben `{vault}.oxid` (z. B. `team.oxid` → `team.lock`) |
| **Atomarität** | `OpenOptions::create_new(true)` — nur ein Prozess gewinnt |
| **Metadaten** | JSON: `{ "user", "pid", "host" }` |
| **Stale-Repair** | Beim `acquire`: existierende Lock-Datei → `sysinfo` prüft PID auf gleichem Host → tot → Lock löschen & erneut versuchen |
| **Fehler** | `VaultError::LockedBy(LockMetadata)` — Anzeige, wer den Tresor hält |
| **Release** | `Vault::close()` oder `Drop` auf `Vault` |
| **Smart-Start** | `attach_locked` → `acquire_vault_lock` · `unlock` → `assert_lock_valid` vor Entschlüsselung |
| **Lock verloren** | `VaultError::LockLost` — kein `unlock` ohne gültige `{vault}.lock` |
| **Audit `VaultUnlocked`** | `entry_id` = Lock-ID (`user@host:pid`) des aktiven Datei-Locks |

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

## 13. Zentrales Policy-Management & Admin-GPOs

> **Status:** ✅ `crates/vault-core/src/policy/` · Startup in `main.rs` · `get_resolved_config`  
> **Ziel:** Machine-wide Admin-Richtlinien (GPO-Stil) überschreiben lokale User-Einstellungen

### Policy-Datei (Read-Only für End-User)

| Plattform | Pfad |
|---|---|
| **Windows** | `C:\ProgramData\OxidVault\policy.json` |
| **Linux / macOS** | `/etc/oxidvault/policy.json` |

Die Datei wird beim App-Start via `policy::init_admin_policy()` geladen und im Prozess gecacht. Fehlerhaftes JSON führt zum Abbruch (Compliance).

**Beispiel `policy.json`:**

```json
{
  "forceLockOnMinimize": true,
  "autoLockSeconds": 60,
  "gitSyncEnabled": false,
  "minMasterPasswordLen": 16
}
```

### Datenmodell

| Typ | Rolle |
|---|---|
| **`AdminPolicy`** | Nur gesetzte Felder (`Option<T>`) sind bindend — Read-Only für User |
| **`UserPolicyPreferences`** | Lokale Werte aus `settings.json` + Defaults |
| **`ResolvedConfig`** | Effektive Konfiguration nach Merge |

### Override-Logik

`resolve_config(user)` — für jedes Feld:

- Admin-Feld **gesetzt** → `value = admin`, `disabled = true` (UI-Schalter gesperrt)
- Admin-Feld **nicht gesetzt** → `value = user`, `disabled = false`

```
settings.json (User)  +  policy.json (Admin)  →  ResolvedConfig (effektiv + UI-Flags)
```

### Unterstützte Policy-Felder

| Feld | Wirkung |
|---|---|
| `forceLockOnMinimize` | Lock-on-Minimize in `window_events.rs` |
| `autoLockSeconds` | Inaktivitäts-Auto-Lock (`useAutoLock` im Frontend) |
| `gitSyncEnabled` | Git-Sync Toggle + `sync_vault_git` |
| `minMasterPasswordLen` | Master-Passwort-Validierung bei `Vault::create` |

### Frontend-Anbindung

| IPC | Rückgabe |
|---|---|
| `get_resolved_config` | `ResolvedConfig` mit `{ value, disabled }` pro Feld |

Das Frontend nutzt `disabled: true`, um UI-Elemente zu sperren (z. B. Git-Sync-Checkbox in `SettingsMenu.tsx`).

### Startup

```rust
// main.rs
vault_core::policy::init_admin_policy()?;
```

---

## 14. Dokumentationspflicht & Changelog

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
| 2025-06-19 | 1.0.0 | **Security-Härtung K1–K4:** `Zeroizing` in crypto/format, Zero-Clone-`persist`, `SecretEntryPublic`, `reveal_secret`, `copy_to_clipboard` (arboard, 30s Rust-Clear), `Zeroizing<String>` für Master-Passwort-IPC |
| 2025-06-19 | 1.0.0 | Dependency-Audit: `russh` 0.61 (`ring`), `rsa` aus Dependency-Tree entfernt |
| 2025-06-19 | 1.0.0 | **Native Messaging Phase 1:** CLI `--native-messaging` (Headless), `native_messaging.rs` (stdio LE-Framing), Dummy `ping`→`pong`, Manifest `browser-extension/host/com.oxidvault.app.json` |
| 2025-06-19 | 1.0.0 | **Native Messaging Phase 2:** MV3-Extension (`manifest.json`, `background.js`), `register_native_host.ps1` (Chrome/Edge Registry), E2E-Anleitung in `browser-extension/README.md` |
| 2025-06-20 | 1.0.0 | **Native Messaging Windows-Fix:** dedizierte Console-Binary `oxidvault-nmh.exe` (stdout-Pipe mit Chrome/Edge), Register-Skript + Extension-Timeout-Logging |
| 2025-06-20 | 1.0.0 | **Native Messaging Phase 3:** `content.js` Login-Erkennung + AutoFill, `get_login` über NM→localhost-IPC→Vault, `url_match.rs`, `find_web_login_for_hostname` |
| 2025-06-20 | 1.0.0 | **ISO-27001 Audit-Log:** `audit.rs` (append-only, hash chain), `AuditAction`/`AuditLogger`, Vault-Integration; Security-Dashboard → `security_audit.rs` |
| 2025-06-20 | 1.0.0 | **ISO-27001 OS-Schutz:** `audit_secure.rs` — Windows-DACL (User + Administrators), Unix `0o600`, `audit::init()` Startup-Check in `main.rs` |
| 2025-06-20 | 1.0.0 | **UNC + Atomic Writes:** `path_util.rs`, robuster `atomic_write_vault` (Temp im selben Share, Rename + SMB-Copy-Fallback), Doku §12 |
| 2025-06-20 | 1.0.0 | **Vault-Datei-Lock:** `lock.rs` — exklusiver `{vault}.lock`, Stale-Repair via `sysinfo`, `LockedBy`-Fehler, `Vault::open`/`close`/`Drop` |
| 2025-06-20 | 1.0.0 | **Lock-Assertion:** `unlock` + Smart-Start (`attach_locked`) mit `assert_lock_valid`, `LockLost`, Audit `VaultUnlocked` mit Lock-ID |
| 2025-06-20 | 1.0.0 | **Admin-GPO:** `policy/admin.rs`, `policy.json` (ProgramData/etc), `ResolvedConfig`, `get_resolved_config`, UI-`disabled`-Flags |
| 2025-06-20 | 1.0.0 | **Audit-Log UI:** `get_audit_logs`, `read_audit_logs`/`AuditLogEntry`, Tab **Aktivität**, `AuditLogTable.tsx` (Suche, lokale Zeit, DE-Labels) |

---

*OxidVault — Built for admins who don't have time for slow tools.*
