# OxidVault — Browser-Extension (Chrome Web Store)

Distribution via **Chrome Web Store (Unlisted)**. The desktop MSI ships only `oxidvault-nmh.exe`; the extension is installed from the store.

## Build upload package

```powershell
npm run extension:package
```

Output: `installer/dist/OxidVault-extension-<version>.zip`

Upload at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## After first publish

1. Copy the extension ID from `chrome://extensions` (developer mode).
2. Save it locally (gitignored):

   ```powershell
   Copy-Item browser-extension\extension.id.example browser-extension\extension.id
   # Edit extension.id — paste your 32-character store ID
   ```

3. Register Native Messaging for dev builds only:

   ```powershell
   # Dev build
   .\scripts\register_native_host.ps1

   ```

   The script resolves the ID from `-ExtensionId`, `browser-extension/extension.id`, or `$env:OXIDVAULT_EXTENSION_ID`.
   MSI installations register Native Messaging automatically during setup.

## Optional enterprise force-install (GPO)

After the extension is in the Web Store, admins may force-install via policy:

```
ExtensionInstallForcelist:
  <store_extension_id>;https://clients2.google.com/service/update2/crx
```

No local CRX, HTTP update server, or MSI extension bundle required.

## manifest.json rules (Web Store)

| Field | Required |
|---|---|
| `manifest_version` | `3` |
| `permissions` | `["nativeMessaging"]` — sufficient for `connectNative("com.oxidvault.app")` |
| `key` | **Must not** be present on first upload (Google assigns the ID) |
| `update_url` | **Must not** be present (Store handles updates) |

## Desktop MSI build

```powershell
npm run tauri:build
```

Builds the Tauri app + `oxidvault-nmh.exe`. Does **not** bundle the browser extension.
The MSI registers Native Messaging for Chrome/Edge automatically (manifest + HKCU registry keys).

Further details: [ARCHITECTURE.md §10](../ARCHITECTURE.md#10-browser-erweiterung--native-messaging-phase-13).
