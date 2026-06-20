use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

use crate::audit::{audit_entries, SecurityAuditReport};
use crate::crypto::{self, KdfParams, MasterKey};
use crate::entry::{
    RevealedSecret, SecretEntry, SecretEntryInput, SecretEntryPublic, SecretEntrySummary,
    SecretField, SecretPayload, REVEAL_SECRET_WARNING,
};
use crate::error::VaultError;
use crate::format;
use crate::policy::validate_master_password;
use crate::probe::{resolve_probe_target, ProbeTarget};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultInfo {
    pub version: String,
    pub name: String,
    pub path: Option<String>,
    pub entry_count: usize,
    pub locked: bool,
    pub initialized: bool,
}

pub struct Vault {
    path: Option<PathBuf>,
    name: String,
    locked: bool,
    kdf: KdfParams,
    salt: Option<[u8; crypto::SALT_LEN]>,
    master_key: Option<MasterKey>,
    entries: Vec<SecretEntry>,
    cached_entry_count: usize,
}

impl Default for Vault {
    fn default() -> Self {
        Self::new()
    }
}

impl Vault {
    pub fn new() -> Self {
        Self {
            path: None,
            name: String::new(),
            locked: true,
            kdf: KdfParams::default(),
            salt: None,
            master_key: None,
            entries: Vec::new(),
            cached_entry_count: 0,
        }
    }

    pub fn create(
        &mut self,
        path: impl AsRef<Path>,
        name: impl Into<String>,
        password: &str,
    ) -> Result<(), VaultError> {
        let path = path.as_ref().to_path_buf();
        if path.exists() {
            return Err(VaultError::FileExists);
        }

        validate_master_password(password)?;

        let name = name.into();
        let salt = crypto::random_salt();
        let key = MasterKey::derive_from_password(password, &salt, self.kdf)?;

        format::write_vault_file(&path, &name, self.kdf, &salt, &key, &[])?;

        self.path = Some(path);
        self.name = name;
        self.salt = Some(salt);
        self.master_key = Some(key);
        self.entries.clear();
        self.cached_entry_count = 0;
        self.locked = false;
        Ok(())
    }

    pub fn open(&mut self, path: impl AsRef<Path>, password: &str) -> Result<(), VaultError> {
        let path = path.as_ref().to_path_buf();
        let meta = format::read_vault_meta(&path)?;
        let key = MasterKey::derive_from_password(password, &meta.salt, meta.kdf)?;
        let (_, payload) = format::read_vault_file(&path, &key)?;

        self.path = Some(path);
        self.name = meta.name;
        self.kdf = meta.kdf;
        self.salt = Some(meta.salt);
        self.master_key = Some(key);
        self.entries = payload.entries;
        self.cached_entry_count = self.entries.len();
        self.locked = false;
        Ok(())
    }

    pub fn unlock(&mut self, password: &str) -> Result<(), VaultError> {
        if !self.locked {
            return Ok(());
        }

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        let meta = format::read_vault_meta(&path)?;
        let key = MasterKey::derive_from_password(password, &meta.salt, meta.kdf)?;
        let (_, payload) = format::read_vault_file(&path, &key)?;

        self.master_key = Some(key);
        self.entries = payload.entries;
        self.cached_entry_count = self.entries.len();
        self.locked = false;
        Ok(())
    }

    /// Locks the vault and purges decrypted secrets and the master key from RAM.
    pub fn lock(&mut self) {
        self.cached_entry_count = self.entries.len();
        for entry in &mut self.entries {
            entry.zeroize_secrets();
        }
        self.master_key = None;
        self.entries.clear();
        self.locked = true;
    }

    /// Attaches a vault file path in locked state (no secrets loaded). Used on app startup.
    pub fn attach_locked(&mut self, path: impl AsRef<Path>) -> Result<(), VaultError> {
        let path = path.as_ref().to_path_buf();
        if !path.is_file() {
            return Err(VaultError::NoVaultFile);
        }

        let meta = format::read_vault_meta(&path)?;
        self.path = Some(path);
        self.name = meta.name;
        self.kdf = meta.kdf;
        self.salt = Some(meta.salt);
        self.master_key = None;
        self.entries.clear();
        self.cached_entry_count = 0;
        self.locked = true;
        Ok(())
    }

    pub fn add_entry(&mut self, input: SecretEntryInput) -> Result<SecretEntrySummary, VaultError> {
        self.ensure_unlocked()?;
        let entry = SecretEntry::from_input(input)?;
        let summary = entry.summary();
        self.entries.push(entry);
        self.persist()?;
        Ok(summary)
    }

    pub fn update_entry(
        &mut self,
        id: &str,
        input: SecretEntryInput,
    ) -> Result<SecretEntrySummary, VaultError> {
        self.ensure_unlocked()?;
        let idx = self
            .entries
            .iter()
            .position(|e| e.id == id)
            .ok_or(VaultError::EntryNotFound)?;

        let existing = &self.entries[idx];
        if existing.payload.kind_tag() != input.payload.kind_tag() {
            return Err(VaultError::Other("cannot change entry type".into()));
        }

        let created_at = existing.created_at.clone();
        let entry = SecretEntry::update_from(id, created_at, input)?;
        let summary = entry.summary();
        self.entries[idx] = entry;
        self.persist()?;
        Ok(summary)
    }

    pub fn list_entries(&self) -> Result<Vec<SecretEntrySummary>, VaultError> {
        self.ensure_unlocked()?;
        Ok(self.entries.iter().map(SecretEntry::summary).collect())
    }

    /// IPC-safe metadata view — no plaintext secrets cross the bridge.
    pub fn get_entry_public(&self, id: &str) -> Result<SecretEntryPublic, VaultError> {
        self.ensure_unlocked()?;
        self.entries
            .iter()
            .find(|e| e.id == id)
            .map(SecretEntry::to_public)
            .ok_or(VaultError::EntryNotFound)
    }

    /// Extracts a sensitive field into a zeroizing buffer for clipboard or one-shot reveal.
    pub fn extract_secret(
        &self,
        id: &str,
        field: SecretField,
    ) -> Result<Zeroizing<String>, VaultError> {
        self.ensure_unlocked()?;
        let entry = self
            .entries
            .iter()
            .find(|e| e.id == id)
            .ok_or(VaultError::EntryNotFound)?;
        entry.payload.extract_field(field)
    }

    /// One-shot reveal over IPC — value is still cloned for serialization; frontend must discard.
    pub fn reveal_secret(
        &self,
        id: &str,
        field: SecretField,
    ) -> Result<RevealedSecret, VaultError> {
        let value = self.extract_secret(id, field)?;
        Ok(RevealedSecret {
            value: value.to_string(),
            warning: REVEAL_SECRET_WARNING.to_string(),
        })
    }

    /// Finds the best-matching web-login for a page hostname (least-privilege: one entry).
    ///
    /// Returns `(username, password)` only when the vault is unlocked and a match exists.
    pub fn find_web_login_for_hostname(
        &self,
        page_hostname: &str,
    ) -> Result<Option<(String, Zeroizing<String>)>, VaultError> {
        use crate::url_match::{score_web_login_url_match, UrlMatchScore};

        self.ensure_unlocked()?;

        let mut best: Option<(UrlMatchScore, &SecretEntry)> = None;

        for entry in &self.entries {
            let SecretPayload::WebLogin { url, .. } = &entry.payload else {
                continue;
            };

            let score = score_web_login_url_match(url, page_hostname);
            if score == UrlMatchScore::None {
                continue;
            }

            if best.as_ref().is_none_or(|(s, _)| score > *s) {
                best = Some((score, entry));
            }
        }

        let Some((_, entry)) = best else {
            return Ok(None);
        };

        let SecretPayload::WebLogin { username, .. } = &entry.payload else {
            return Ok(None);
        };

        let password = self.extract_secret(&entry.id, SecretField::Password)?;
        Ok(Some((username.clone(), password)))
    }

    pub fn probe_target_for_entry(&self, id: &str) -> Option<ProbeTarget> {
        self.entries
            .iter()
            .find(|e| e.id == id)
            .and_then(|e| resolve_probe_target(&e.payload))
    }

    pub fn extract_ssh_credentials(
        &self,
        entry_id: &str,
    ) -> Result<(String, String, String, Option<String>), VaultError> {
        self.ensure_unlocked()?;
        let entry = self
            .entries
            .iter()
            .find(|e| e.id == entry_id)
            .ok_or(VaultError::EntryNotFound)?;
        match &entry.payload {
            SecretPayload::SshKey {
                host,
                username,
                private_key,
                passphrase,
            } => Ok((
                host.clone(),
                username.clone(),
                private_key.clone(),
                passphrase.clone(),
            )),
            _ => Err(VaultError::Other("entry is not an SSH key".into())),
        }
    }

    pub fn audit_security(&self) -> Result<SecurityAuditReport, VaultError> {
        self.ensure_unlocked()?;
        Ok(audit_entries(&self.entries))
    }

    /// Re-reads the vault file from disk after an external change (e.g. Git pull).
    pub fn reload_from_disk(&mut self) -> Result<(), VaultError> {
        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        if self.locked {
            return self.attach_locked(path);
        }

        let key = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        let meta = format::read_vault_meta(&path)?;
        let (_, payload) = format::read_vault_file(&path, key)?;

        self.name = meta.name;
        self.entries = payload.entries;
        self.cached_entry_count = self.entries.len();
        Ok(())
    }

    pub fn info(&self) -> VaultInfo {
        VaultInfo {
            version: crate::VAULT_VERSION.to_string(),
            name: self.name.clone(),
            path: self.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            entry_count: if self.locked {
                self.cached_entry_count
            } else {
                self.entries.len()
            },
            locked: self.locked,
            initialized: self.path.is_some(),
        }
    }

    fn ensure_unlocked(&self) -> Result<(), VaultError> {
        if self.locked {
            Err(VaultError::Locked)
        } else {
            Ok(())
        }
    }

    fn persist(&self) -> Result<(), VaultError> {
        let path = self.path.as_ref().ok_or(VaultError::NoVaultFile)?;
        let key = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        let salt = self.salt.ok_or(VaultError::NotInitialized)?;
        format::update_vault_file(path, &self.name, self.kdf, &salt, key, &self.entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{SecretEntryInput, SecretPayload};
    use tempfile::tempdir;

    #[test]
    fn attach_locked_then_unlock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault.create(&path, "TestVault", "correct-horse-battery-staple").unwrap();
        vault.lock();

        let mut cold = Vault::new();
        cold.attach_locked(&path).unwrap();
        assert!(cold.info().locked);
        assert!(cold.info().initialized);
        assert_eq!(cold.info().name, "TestVault");

        cold.unlock("correct-horse-battery-staple").unwrap();
        assert!(!cold.info().locked);
    }

    #[test]
    fn create_add_lock_unlock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault.create(&path, "TestVault", "correct-horse-battery-staple").unwrap();
        assert!(!vault.info().locked);

        vault
            .add_entry(SecretEntryInput {
                title: "SSH".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::SshKey {
                    host: "10.0.0.1".into(),
                    username: "root".into(),
                    private_key: "-----BEGIN KEY-----".into(),
                    passphrase: None,
                },
            })
            .unwrap();
        assert_eq!(vault.info().entry_count, 1);

        vault.lock();
        assert!(vault.info().locked);

        let mut vault2 = Vault::new();
        vault2.path = Some(path.clone());
        vault2.name = "TestVault".into();
        vault2.locked = true;
        vault2.unlock("correct-horse-battery-staple").unwrap();
        assert_eq!(vault2.list_entries().unwrap().len(), 1);
    }

    #[test]
    fn update_entry_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault.create(&path, "TestVault", "correct-horse-battery-staple").unwrap();

        let summary = vault
            .add_entry(SecretEntryInput {
                title: "GitHub".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::WebLogin {
                    url: "https://github.com".into(),
                    username: "dev".into(),
                    password: "old-secret".into(),
                    notes: None,
                },
            })
            .unwrap();

        vault
            .update_entry(
                &summary.id,
                SecretEntryInput {
                    title: "GitHub Prod".into(),
                    folder: None,
                    tags: vec![],
                    expires_at: None,
                    payload: SecretPayload::WebLogin {
                        url: "https://github.com/org".into(),
                        username: "admin".into(),
                        password: "new-secret".into(),
                        notes: Some("updated".into()),
                    },
                },
            )
            .unwrap();

        let public = vault.get_entry_public(&summary.id).unwrap();
        assert_eq!(public.title, "GitHub Prod");
        let password = vault
            .extract_secret(&summary.id, SecretField::Password)
            .unwrap();
        assert_eq!(password.as_str(), "new-secret");

        vault.lock();
        let mut vault2 = Vault::new();
        vault2.path = Some(path);
        vault2.name = "TestVault".into();
        vault2.locked = true;
        vault2.unlock("correct-horse-battery-staple").unwrap();
        let reloaded = vault2.get_entry_public(&summary.id).unwrap();
        assert_eq!(reloaded.title, "GitHub Prod");
    }

    #[test]
    fn find_web_login_for_hostname() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault.create(&path, "TestVault", "correct-horse-battery-staple").unwrap();

        vault
            .add_entry(SecretEntryInput {
                title: "Example".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::WebLogin {
                    url: "https://example.com/login".into(),
                    username: "alice".into(),
                    password: "s3cret".into(),
                    notes: None,
                },
            })
            .unwrap();

        let found = vault
            .find_web_login_for_hostname("example.com")
            .unwrap()
            .expect("match");
        assert_eq!(found.0, "alice");
        assert_eq!(found.1.as_str(), "s3cret");

        assert!(vault
            .find_web_login_for_hostname("unknown.example.org")
            .unwrap()
            .is_none());
    }
}
