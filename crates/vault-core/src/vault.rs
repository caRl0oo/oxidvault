use std::path::{Path, PathBuf};

use crate::audit::{audit_entries, SecurityAuditReport};
use crate::crypto::{self, KdfParams, MasterKey};
use crate::entry::{SecretEntry, SecretEntryInput, SecretEntrySummary};
use crate::error::VaultError;
use crate::format::{self, VaultPayload};
use crate::policy::validate_master_password;

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
        let payload = VaultPayload { entries: vec![] };

        format::write_vault_file(&path, &name, self.kdf, &salt, &key, &payload)?;

        self.path = Some(path);
        self.name = name;
        self.salt = Some(salt);
        self.master_key = Some(key);
        self.entries = payload.entries;
        self.cached_entry_count = self.entries.len();
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

    pub fn get_entry(&self, id: &str) -> Result<SecretEntry, VaultError> {
        self.ensure_unlocked()?;
        self.entries
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or(VaultError::EntryNotFound)
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
        let payload = VaultPayload {
            entries: self.entries.clone(),
        };
        format::update_vault_file(path, &self.name, self.kdf, &salt, key, &payload)
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

        let entry = vault.get_entry(&summary.id).unwrap();
        assert_eq!(entry.title, "GitHub Prod");
        assert!(matches!(
            entry.payload,
            SecretPayload::WebLogin { ref password, .. } if password == "new-secret"
        ));

        vault.lock();
        let mut vault2 = Vault::new();
        vault2.path = Some(path);
        vault2.name = "TestVault".into();
        vault2.locked = true;
        vault2.unlock("correct-horse-battery-staple").unwrap();
        let reloaded = vault2.get_entry(&summary.id).unwrap();
        assert_eq!(reloaded.title, "GitHub Prod");
    }
}
