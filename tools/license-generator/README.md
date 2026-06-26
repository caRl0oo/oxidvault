# OxidVault License Generator

**INTERNAL TOOL — never distribute, never publish.**

## Erstmalige Einrichtung (einmalig)

1. Echten HMAC-Key generieren:

```bash
openssl rand -hex 32
```

2. Key bereitstellen (niemals in Git committen):
   - **Generator (lokal):** `~/.oxidvault_license_key` oder `OXIDVAULT_LICENSE_KEY`
   - **App (Runtime):** `C:\ProgramData\OxidVault\license_hmac.key` (Windows) bzw. `/etc/oxidvault/license_hmac.key` (Linux/macOS) oder `OXIDVAULT_LICENSE_KEY`

⚠️ Den echten Key niemals in Git committen.

## Verwendung

Enterprise-Lizenz (1 Jahr, unbegrenzte User):

```bash
cargo run -p license-generator -- \
  --licensee "Musterfirma GmbH" \
  --plan enterprise \
  --max-users 0 \
  --valid-until 2027-06-25 \
  --output musterfirma-gmbh.license
```

Community-Lizenz (5 User):

```bash
cargo run -p license-generator -- \
  --licensee "Kleine GmbH" \
  --plan community \
  --max-users 5 \
  --valid-until 2027-06-25 \
  --output kleine-gmbh.license
```

## Lieferung an Kunden

1. Generierte `.license` Datei per Email senden
2. Kunde legt sie ab:
   - Windows: `C:\ProgramData\OxidVault\oxidvault.license`
   - Linux: `/etc/oxidvault/oxidvault.license`
3. OxidVault neu starten → Enterprise Edition aktiv

## Preismodell (Referenz)

| Plan | User | Preis |
|---|---|---|
| Community | bis 5 | kostenlos |
| Enterprise | unbegrenzt | auf Anfrage |

Kontakt: support@oxidvault.de
