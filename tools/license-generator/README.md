# OxidVault License Generator

**INTERNAL TOOL — never distribute, never publish.**

## Erstmalige Einrichtung (einmalig)

1. Echten HMAC-Key generieren:

```bash
openssl rand -hex 32
```

2. Key in **beiden** Dateien eintragen:
   - `tools/license-generator/src/main.rs` → `LICENSE_HMAC_KEY`
   - `crates/vault-core/src/license.rs` → `LICENSE_HMAC_KEY`

3. Beide Dateien zu `.gitignore` hinzufügen oder
   Key über Umgebungsvariable injizieren (empfohlen für CI).

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
