# Admin Deployment Guide

> **Audience:** IT administrators · **Rollout time:** ~5 minutes per tenant (MSI + `policy.json` + optional Chrome Web Store)  
> **Technical reference:** [ARCHITECTURE.md §13 — Policy Management](../ARCHITECTURE.md#13-centralized-policy-management--admin-gpos) · **Template:** [`policy.json.example`](policy.json.example)

### 1. Overview

OxidVault separates **installation** (MSI / desktop app, Chrome Web Store extension) from **governance** (`policy.json`). The policy file is **not** created by the installer — admins deploy it deliberately via GPO, Intune, Ansible, or image build.

| Component | Deployed by | Path / source |
|---|---|---|
| Desktop app (MSI) | IT | `C:\Program Files\OxidVault\` |
| Browser extension | User / IT (web store) | [Chrome Web Store](https://chrome.google.com/webstore) (unlisted) |
| Admin policy | IT (required only for central policies) | see below |
| Native messaging | User/dev or script after store ID | `register_native_host.ps1` |

### 2. Policy File — Paths

| Platform | Directory | File |
|---|---|---|
| **Windows** | `C:\ProgramData\OxidVault\` | `policy.json` |
| **Linux / macOS** | `/etc/oxidvault/` | `policy.json` |

End users need **no** write access to these paths. On Windows: create folder, deploy JSON, ACLs to `Administrators` + `SYSTEM` (read for `Users` sufficient).

### 3. Example `policy.json`

All fields are **optional** — only set keys are binding for users. Template with field descriptions: [`policy.json.example`](policy.json.example).

```json
{
  "forceLockOnMinimize": true,
  "autoLockSeconds": 120,
  "gitSyncEnabled": false,
  "minMasterPasswordLen": 16
}
```

| Field (camelCase) | Type | Effect |
|---|---|---|
| `forceLockOnMinimize` | `bool` | Vault locks when window minimized |
| `autoLockSeconds` | `u32` | Inactivity auto-lock (seconds) |
| `gitSyncEnabled` | `bool` | Allow/forbid Git sync |
| `minMasterPasswordLen` | `u32` | Minimum master password length (default without policy: **12**) |

No further fields exist in `AdminPolicy` currently — unknown JSON keys are **ignored** by serde (incl. `_documentation` in template).

### 4. Fail-Safe — Why the App Won't Start on Broken JSON

On start, `main.rs` calls `vault_core::policy::init_admin_policy()`:

| State | Behavior |
|---|---|
| `policy.json` **missing** | Normal — app starts with user defaults (`settings.json`) |
| File **present, valid JSON** | Admin values override user settings; UI fields with `disabled: true` |
| File **present, invalid JSON** | **Process exits** — message `OxidVault policy error: admin policy init failed` |

**Rationale (compliance):** A defective or tampered policy must not be silently ignored. Otherwise enforced auto-lock or minimum password rules could be bypassed without admins noticing. Better **no start** than unsafe operation.

### 5. Verification — System Diagnostics & UI

After rollout on a test client:

1. Start OxidVault → tab **Security**
2. **Compliance dashboard:** "GPO managed?" (`adminPolicyActive` / `policyManagedByGpo`)
3. **System diagnostics** → "Copy diagnostics report"

The markdown export includes e.g.:

| Diagnostic field | Meaning |
|---|---|
| `policyStatus.path` | Expected policy path |
| `policyStatus.ok` / `status` | `ok`, `policy_not_configured`, `policy_invalid`, … |
| `policyStatus.policyHash` | SHA-256 of file (integrity proof) |

In the app, `get_resolved_config` → `adminPolicyActive: true` when `policy.json` exists. Locked settings show hint "Admin policy active".

### 6. GPO Rollout — Checklist (Windows, ~5 min.)

1. **MSI** on clients (`npm run tauri:build` → MSI from `src-tauri/target/release/bundle/msi/`)
2. **Extension:** user installs from Chrome Web Store (unlisted) **or** IT sets `ExtensionInstallForcelist` with store update URL:  
   `<extension_id>;https://clients2.google.com/service/update2/crx`
3. **`policy.json`** from [`policy.json.example`](policy.json.example) customize
4. Via **GPO** (Computer Configuration → Preferences → Files) or Intune **File** deploy to:  
   `C:\ProgramData\OxidVault\policy.json`
5. **Native messaging:** automatic with MSI (Chrome/Edge HKCU + host manifest).  
   Dev/debug still manual: `register_native_host.ps1 -BuildProfile release -ExtensionId <id>`
6. **Test client:** system diagnostics + open vault → policy fields locked?

### 7. Linux / macOS

```bash
sudo mkdir -p /etc/oxidvault
sudo cp docs/policy.json.example /etc/oxidvault/policy.json
sudo chmod 644 /etc/oxidvault/policy.json
# Edit JSON — remove or keep keys with '_' (ignored)
```
