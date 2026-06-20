# OxidVault Browser Extension — Phase 3 (AutoFill / get_login)

Minimale Manifest-V3-Erweiterung: Native-Messaging-Brücke + dynamisches AutoFill nach Least-Privilege-Prinzip (nur Hostname der aktuellen Seite).

## Voraussetzungen

- Windows mit Chrome oder Edge (Chromium)
- Release-Build der Desktop-App: `cargo build --release`
- PowerShell (Skript `scripts/register_native_host.ps1`)

---

## AutoFill testen (Phase 3)

1. OxidVault Desktop-App starten, Vault **entsperren**, Web-Login mit passender URL anlegen (z. B. `https://github.com`).
2. Extension neu laden, Login-Seite im Browser öffnen.
3. Bei erkanntem Passwort-Feld füllt `content.js` User/Passwort automatisch (Service-Worker-Konsole: `get_login for …`).

**Voraussetzung:** Desktop-App muss laufen — der NM-Host (`oxidvault-nmh.exe`) leitet `get_login` per localhost-IPC an die GUI weiter.

---

## Ping/Pong E2E-Test in 3 Schritten

### Schritt 1 — Release-Binary bauen

Im Projektroot:

```powershell
cargo build --release
```

Erwartete Dateien: `target/release/oxidvault-nmh.exe` (Native-Messaging-Host) und optional `target/release/oxidvault.exe` (Desktop-GUI).

### Schritt 2 — Erweiterung als „Entpackte Erweiterung“ laden

1. Chrome oder Edge öffnen und `chrome://extensions` bzw. `edge://extensions` aufrufen.
2. **Entwicklermodus** aktivieren (Schalter oben rechts).
3. **Entpackte Erweiterung laden** → Ordner **`browser-extension`** dieses Repos wählen (nicht `browser-extension/host`).
4. Unter der Karte **OxidVault Connector** die **Extension-ID** kopieren (32 Zeichen, z. B. `abcdefghijklmnopqrstuvwxyzabcdef`).

### Schritt 3 — Native Host registrieren

Im Projektroot (Extension-ID aus Schritt 2 einsetzen):

```powershell
.\scripts\register_native_host.ps1 -ExtensionId "abcdefghijklmnopqrstuvwxyzabcdef"
```

Das Skript:

- schreibt `host/com.oxidvault.app.json` mit absolutem Pfad zu `target/release/oxidvault-nmh.exe` (Console-Binary — **nicht** `oxidvault.exe`, da Release-GUI unter Windows stdout-Pipes blockieren kann)
- setzt `allowed_origins` auf `chrome-extension://<DEINE_ID>/`
- trägt den Manifest-Pfad in der Registry für **Chrome** und **Edge** ein

---

## Ergebnis prüfen

1. Auf `chrome://extensions` die Erweiterung **neu laden** (↻), damit der Service Worker startet.
2. Bei **OxidVault Connector** auf **Service Worker** → **Inspect** klicken.
3. In der DevTools-Konsole solltest du sehen:

```
[OxidVault] Connecting to native host "com.oxidvault.app"…
[OxidVault] Sending ping: {action: "ping"}
[OxidVault] Received from host: {status: "pong"}
[OxidVault] Ping/Pong E2E OK
```

Bei Fehlern (z. B. `Native host disconnected`) zuerst prüfen:

- `target/release/oxidvault-nmh.exe` existiert (nach `cargo build --release`)
- `register_native_host.ps1` mit der **aktuellen** Extension-ID ausgeführt
- Extension danach neu geladen

---

## Dateien

| Datei | Rolle |
|---|---|
| `manifest.json` | Manifest V3, Permission `nativeMessaging`, Background Service Worker |
| `content.js` | Login-Formular-Erkennung, AutoFill |
| `background.js` | `connectNative`, `get_login`-Relay, Ping |
| `host/com.oxidvault.app.json` | Native-Host-Manifest (wird vom PS-Skript geschrieben) |

Weitere Architekturdetails: [ARCHITECTURE.md §10](../ARCHITECTURE.md#10-browser-erweiterung--native-messaging-phase-1).
