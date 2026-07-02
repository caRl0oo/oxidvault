# OxidVault Browser Extension

Manifest V3 extension for controlled web-login autofill via native messaging to the OxidVault desktop app.

## Quick start (dev/debug)

1. **Build native host:** `cargo build --release`
2. **Load extension:** `chrome://extensions` → Developer mode → Load unpacked → select this folder → copy extension ID
3. **Register host:** `.\scripts\register_native_host.ps1 -ExtensionId "<ID>"` → reload extension → service worker console: `{ status: "pong" }`

> **Production:** Install MSI + extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/oxidvault/belagnpfebgljfamjihdoinbcehingjd) — native messaging is registered automatically.

Full architecture and protocol: [`ARCHITECTURE.md`](../ARCHITECTURE.md) §10.

## Anti-phishing (v0.5.0+)

| Control | Behavior |
|---|---|
| **eTLD+1 matching** | Vault lookup uses Mozilla PSL (`psl` in `vault-core`) — subdomain of registrable domain only; no substring / path matching |
| **No-eTLD fallback** | IPs, `localhost`, single-label intranet hosts — exact host match only |
| **Punycode** | IDN hosts normalized to punycode before comparison |
| **User gesture** | Autofill runs only after a trusted `focusin` on a detected username/password field — never on page load |
| **Tab hostname authority** | `background.js` reads hostname from `sender.tab.url`; content script cannot choose the lookup domain |

## WASM password generator

```powershell
.\scripts\build-wasm.ps1
```

Build output lands in `pkg/` for the popup generator.

## Versioning

Bump `version` in `manifest.json` for each store upload. Current: **0.5.0** (anti-phishing autofill + eTLD+1 matching).
