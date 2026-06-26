# OxidVault License Generator

**INTERNAL TOOL — never distribute, never publish.**

## Erstmalige Einrichtung (einmalig)

### 1. Keypair generieren

```bash
cargo run -p license-generator -- generate-keypair \
  --output oxidvault_private.key
```

Output zeigt den Public Key — für den nächsten Schritt kopieren.

### 2. Private Key sicher aufbewahren

- Niemals in Git committen
- In OxidVault selbst speichern 😄
- Backup erstellen

### 3. Public Key als Build-Variable setzen

```powershell
# Windows — für diesen Build-Vorgang
$env:OXIDVAULT_PUBLIC_KEY = "dein-public-key-base64"
cargo build --release
```

Der Public Key wird in die Binary eingebettet.
Er ist KEIN Secret — er kann nur verifizieren, nicht signieren.

## Lizenz generieren

```bash
cargo run -p license-generator -- generate \
  --licensee "Kunde GmbH" \
  --plan enterprise \
  --max-users 0 \
  --valid-until 2027-12-31 \
  --private-key oxidvault_private.key \
  --output kunde-gmbh.license
```

## Lieferung an Kunden

1. `kunde-gmbh.license` per Email senden
2. Kunde legt ab unter:
   - Windows: `C:\ProgramData\OxidVault\oxidvault.license`
   - Linux: `/etc/oxidvault/oxidvault.license`
3. OxidVault neu starten → Enterprise aktiv
