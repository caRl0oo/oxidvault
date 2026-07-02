// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::audit::{derive_audit_hmac_key, AuditAction, AuditLogger, AUDIT_CHECKPOINT_INTERVAL};
use crate::auth::{self, AuthError};
use crate::crypto::{self, KdfParams, MasterKey};
use crate::entry::{
    RevealedSecret, SecretEntry, SecretEntryInput, SecretEntryPublic, SecretEntrySummary,
    SecretField, SecretPayload, REVEAL_SECRET_WARNING,
};
use crate::error::VaultError;
use crate::format;
use crate::lock::VaultLock;
use crate::mfa::{self, MfaSetupInfo, MfaStatus, StoredMfaConfig};
use crate::path_util::normalize_vault_path;
use crate::policy::{admin_policy, validate_master_password_with_min_len, MIN_MASTER_PASSWORD_LEN};
use crate::probe::{resolve_probe_target, ProbeTarget};
use crate::security_audit::{audit_entries, SecurityAuditReport};
use crate::unlock::UnlockStep;
use crate::vault_user::{
    build_vault_user, derive_user_kek, rewrap_user_dek, to_public, unwrap_user_dek,
    user_mfa_enabled, validate_username, UnlockedUser, UserRole, VaultUser, VaultUserPublic,
};

/// `(host, username, private_key, passphrase, known_host_fingerprint)`
pub type SshConnectCredentials = (String, String, String, Option<String>, Option<String>);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultInfo {
    pub version: String,
    pub name: String,
    pub path: Option<String>,
    pub entry_count: usize,
    pub locked: bool,
    pub initialized: bool,
    pub is_multi_user: bool,
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
    audit_logger: AuditLogger,
    vault_lock: Option<VaultLock>,
    format_version: u16,
    key_created_at: Option<u64>,
    key_rotated_at: Option<u64>,
    kek: Option<MasterKey>,
    mfa: Option<StoredMfaConfig>,
    pending_mfa_secret: Option<Zeroizing<Vec<u8>>>,
    users: Vec<VaultUser>,
    current_user: Option<UnlockedUser>,
    /// v3 only: current user's KEK for MFA operations; zeroed on lock.
    session_kek: Option<Zeroizing<[u8; 32]>>,
    /// v2+ only: HKDF-derived audit HMAC key; cleared on lock.
    audit_hmac_key: Option<Zeroizing<[u8; 32]>>,
    audit_events_since_checkpoint: Mutex<u32>,
}

enum UnlockAuditAction {
    Opened,
    Unlocked { lock_id: String },
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
            audit_logger: AuditLogger::disabled(),
            vault_lock: None,
            format_version: format::FORMAT_VERSION_V2,
            key_created_at: None,
            key_rotated_at: None,
            kek: None,
            mfa: None,
            pending_mfa_secret: None,
            users: Vec::new(),
            current_user: None,
            session_kek: None,
            audit_hmac_key: None,
            audit_events_since_checkpoint: Mutex::new(0),
        }
    }

    fn release_vault_lock(&mut self) -> Result<(), VaultError> {
        if let Some(mut lock) = self.vault_lock.take() {
            lock.release()?;
        }
        Ok(())
    }

    fn acquire_vault_lock(&mut self, path: &Path) -> Result<(), VaultError> {
        self.release_vault_lock()?;
        let mut lock = VaultLock::new(path);
        lock.acquire()?;
        self.vault_lock = Some(lock);
        Ok(())
    }

    /// Releases the exclusive vault file lock without clearing vault state.
    pub fn close(&mut self) -> Result<(), VaultError> {
        self.release_vault_lock()
    }

    fn assert_lock_valid(&self) -> Result<crate::lock::LockMetadata, VaultError> {
        self.vault_lock
            .as_ref()
            .ok_or(VaultError::LockLost)?
            .assert_held()
    }

    fn bind_audit_logger(&mut self, vault_path: &Path) -> Result<(), VaultError> {
        self.audit_logger = AuditLogger::for_vault(vault_path)?;
        Ok(())
    }

    fn audit(&self, action: AuditAction) -> Result<(), VaultError> {
        self.audit_logger.log(action)?;
        if let Some(key) = self.audit_hmac_key.as_ref() {
            let should_checkpoint = {
                let mut count = self
                    .audit_events_since_checkpoint
                    .lock()
                    .map_err(|_| VaultError::Other("audit counter lock poisoned".into()))?;
                *count += 1;
                *count >= AUDIT_CHECKPOINT_INTERVAL
            };
            if should_checkpoint {
                self.audit_logger.log_checkpoint(&key[..])?;
                if let Ok(mut count) = self.audit_events_since_checkpoint.lock() {
                    *count = 0;
                }
            }
        }
        Ok(())
    }

    fn establish_audit_session(&mut self) -> Result<(), VaultError> {
        if self.format_version == format::FORMAT_VERSION_V1 {
            self.audit_hmac_key = None;
            return Ok(());
        }
        let dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        self.audit_hmac_key = Some(derive_audit_hmac_key(dek));
        if let Ok(mut count) = self.audit_events_since_checkpoint.lock() {
            *count = 0;
        }
        let key = self.audit_hmac_key.as_ref().expect("audit key");
        self.audit_logger.log_checkpoint(&key[..])?;
        Ok(())
    }

    /// Records a compliance audit event (metadata-only — no secret payloads).
    pub fn record_audit(&self, action: AuditAction) -> Result<(), VaultError> {
        self.audit(action)
    }

    fn parse_entry_uuid(id: &str) -> Result<uuid::Uuid, VaultError> {
        uuid::Uuid::parse_str(id).map_err(|_| VaultError::Other("invalid entry UUID".into()))
    }

    /// Logs a failed vault unlock attempt when the master password is wrong.
    pub fn record_auth_failed(&self) -> Result<(), VaultError> {
        self.audit(AuditAction::AuthFailed)
    }

    pub fn record_sync_event(&self, status: impl Into<String>) -> Result<(), VaultError> {
        self.audit(AuditAction::SyncEvent {
            status: status.into(),
        })
    }

    pub fn record_config_changed(&self, area: impl Into<String>) -> Result<(), VaultError> {
        self.audit(AuditAction::ConfigChanged { area: area.into() })
    }

    pub fn record_secret_copied(&self, id: &str) -> Result<(), VaultError> {
        self.audit(AuditAction::SecretCopied {
            id: Self::parse_entry_uuid(id)?,
        })
    }

    pub fn create(
        &mut self,
        path: impl AsRef<Path>,
        name: impl Into<String>,
        password: &str,
    ) -> Result<(), VaultError> {
        let path = normalize_vault_path(path)?;
        if path.exists() {
            return Err(VaultError::FileExists);
        }

        validate_master_password_with_min_len(password, effective_min_master_password_len())?;

        let name = name.into();
        let salt = crypto::random_salt();
        let kek = MasterKey::derive_from_password(password, &salt, self.kdf)?;
        let dek = MasterKey::generate_data_key();
        let key_created_at = crate::compliance::unix_timestamp_secs();

        format::write_vault_file(
            &path,
            &name,
            self.kdf,
            &salt,
            &kek,
            &dek,
            key_created_at,
            0,
            &[],
        )?;

        self.path = Some(path.clone());
        self.name = name;
        self.salt = Some(salt);
        self.master_key = Some(dek);
        self.kek = Some(kek);
        self.format_version = format::FORMAT_VERSION_V2;
        self.key_created_at = Some(key_created_at);
        self.key_rotated_at = None;
        self.entries.clear();
        self.mfa = None;
        self.pending_mfa_secret = None;
        self.cached_entry_count = 0;
        self.locked = false;
        self.bind_audit_logger(&path)?;
        self.audit(AuditAction::VaultCreated)?;
        self.establish_audit_session()?;
        Ok(())
    }

    pub fn open(
        &mut self,
        path: impl AsRef<Path>,
        password: &str,
        mfa_code: Option<&str>,
    ) -> Result<UnlockStep, VaultError> {
        let path = normalize_vault_path(path)?;
        self.acquire_vault_lock(&path)?;

        let password = Zeroizing::new(password.to_owned());
        let mfa_code = mfa_code.map(|code| Zeroizing::new(code.to_owned()));

        let open_result = match auth::unlock_vault(&path, password, mfa_code) {
            Ok(handle) => {
                self.path = Some(path.clone());
                self.name = handle.meta.name.clone();
                self.kdf = handle.meta.kdf;
                self.salt = Some(handle.meta.salt);
                self.cached_entry_count = handle.payload.entries.len();
                self.apply_unlock_handle(handle, UnlockAuditAction::Opened)?;
                self.bind_audit_logger(&path)?;
                Ok(UnlockStep::Complete)
            }
            Err(AuthError::MfaRequired) => Ok(UnlockStep::MfaRequired),
            Err(AuthError::InvalidPassword) => {
                let _ = crate::audit::log_event_for_vault(&path, AuditAction::AuthFailed);
                Err(VaultError::InvalidPassword)
            }
            Err(AuthError::InvalidMfa) => Err(VaultError::InvalidMfaCode),
            Err(AuthError::Vault(err)) => Err(err),
        };

        if open_result.is_err() || matches!(open_result, Ok(UnlockStep::MfaRequired)) {
            let _ = self.release_vault_lock();
        }

        open_result
    }

    pub fn unlock(
        &mut self,
        password: &str,
        mfa_code: Option<&str>,
    ) -> Result<UnlockStep, VaultError> {
        if !self.locked {
            return Ok(UnlockStep::Complete);
        }

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;

        if self.vault_lock.is_none() {
            self.acquire_vault_lock(&path)?;
        }

        let lock_meta = self.assert_lock_valid()?;
        let password = Zeroizing::new(password.to_owned());
        let mfa_code = mfa_code.map(|code| Zeroizing::new(code.to_owned()));

        match auth::unlock_vault(&path, password, mfa_code) {
            Ok(handle) => {
                self.cached_entry_count = handle.payload.entries.len();
                self.apply_unlock_handle(
                    handle,
                    UnlockAuditAction::Unlocked {
                        lock_id: lock_meta.lock_id(),
                    },
                )?;
                Ok(UnlockStep::Complete)
            }
            Err(AuthError::MfaRequired) => Ok(UnlockStep::MfaRequired),
            Err(AuthError::InvalidPassword) => {
                let _ = self.record_auth_failed();
                Err(VaultError::InvalidPassword)
            }
            Err(AuthError::InvalidMfa) => Err(VaultError::InvalidMfaCode),
            Err(AuthError::Vault(err)) => Err(err),
        }
    }

    /// Locks the vault and purges decrypted secrets and the master key from RAM.
    pub fn lock(&mut self) {
        if !self.locked {
            let _ = self.audit(AuditAction::VaultLocked);
            if let Some(key) = self.audit_hmac_key.as_ref() {
                let _ = self.audit_logger.log_checkpoint(&key[..]);
            }
        }
        self.cached_entry_count = self.entries.len();
        for entry in &mut self.entries {
            entry.zeroize_secrets();
        }
        self.master_key = None;
        self.kek = None;
        self.current_user = None;
        self.session_kek = None;
        self.audit_hmac_key = None;
        if let Ok(mut count) = self.audit_events_since_checkpoint.lock() {
            *count = 0;
        }
        self.entries.clear();
        self.pending_mfa_secret = None;
        self.locked = true;
    }

    /// Attaches a vault file path in locked state (no secrets loaded). Used on app startup.
    pub fn attach_locked(&mut self, path: impl AsRef<Path>) -> Result<(), VaultError> {
        let path = normalize_vault_path(path)?;
        if !path.is_file() {
            return Err(VaultError::NoVaultFile);
        }

        self.acquire_vault_lock(&path)?;

        let meta = format::read_vault_meta(&path)?;
        let key_created_at = effective_key_created_at(&meta, &path);
        let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);
        self.path = Some(path.clone());
        self.name = meta.name;
        self.kdf = meta.kdf;
        self.format_version = meta.format_version;
        self.key_created_at = Some(key_created_at);
        self.key_rotated_at = key_rotated_at;
        self.master_key = None;
        self.kek = None;
        self.current_user = None;
        self.session_kek = None;
        self.entries.clear();
        self.mfa = None;
        self.pending_mfa_secret = None;
        if format::is_multi_user_format(meta.format_version) {
            self.users = meta.users.unwrap_or_default();
            self.salt = None;
        } else {
            self.users.clear();
            self.salt = Some(meta.salt);
        }
        self.cached_entry_count = 0;
        self.locked = true;
        self.bind_audit_logger(&path)?;
        Ok(())
    }

    pub fn add_entry(&mut self, input: SecretEntryInput) -> Result<SecretEntrySummary, VaultError> {
        self.ensure_unlocked()?;
        let entry = SecretEntry::from_input(input)?;
        let summary = entry.summary();
        self.entries.push(entry);
        self.persist()?;
        self.audit(AuditAction::SecretCreated {
            id: Self::parse_entry_uuid(&summary.id)?,
        })?;
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
        let mut input = input;
        merge_ssh_known_host_on_update(&existing.payload, &mut input.payload);
        let entry = SecretEntry::update_from(id, created_at, input)?;
        let summary = entry.summary();
        self.entries[idx] = entry;
        self.persist()?;
        self.audit(AuditAction::SecretModified {
            id: Self::parse_entry_uuid(id)?,
        })?;
        Ok(summary)
    }

    /// Permanently removes a secret from the vault (hard delete — no tombstone flag).
    ///
    /// Sensitive payload fields are zeroized in RAM before the entry is dropped and
    /// the encrypted vault file is atomically rewritten without the entry.
    pub fn delete_entry(&mut self, id: &str) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        let idx = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or(VaultError::EntryNotFound)?;

        self.entries[idx].zeroize_secrets();
        self.entries.remove(idx);
        self.cached_entry_count = self.entries.len();
        self.persist()?;
        self.audit(AuditAction::EntryDeleted {
            id: Self::parse_entry_uuid(id)?,
        })?;
        Ok(())
    }

    /// Hard-deletes a secret by UUID (alias for [`Self::delete_entry`]).
    pub fn delete_secret(&mut self, id: uuid::Uuid) -> Result<(), VaultError> {
        self.delete_entry(&id.to_string())
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
        self.audit(AuditAction::SecretRevealed {
            id: Self::parse_entry_uuid(id)?,
        })?;
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
    ) -> Result<SshConnectCredentials, VaultError> {
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
                known_host_fingerprint,
            } => Ok((
                host.clone(),
                username.clone(),
                private_key.clone(),
                passphrase.clone(),
                known_host_fingerprint.clone(),
            )),
            _ => Err(VaultError::Other("entry is not an SSH key".into())),
        }
    }

    /// Persists a trusted SSH host key fingerprint for an entry.
    pub fn update_entry_fingerprint(
        &mut self,
        entry_id: &str,
        fingerprint: &str,
    ) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        let fp = fingerprint.trim();
        if fp.is_empty() {
            return Err(VaultError::Other("host key fingerprint is empty".into()));
        }

        let idx = self
            .entries
            .iter()
            .position(|e| e.id == entry_id)
            .ok_or(VaultError::EntryNotFound)?;

        let entry = &mut self.entries[idx];
        let SecretPayload::SshKey {
            known_host_fingerprint,
            ..
        } = &mut entry.payload
        else {
            return Err(VaultError::Other("entry is not an SSH key".into()));
        };

        *known_host_fingerprint = Some(fp.to_string());
        entry.updated_at = unix_timestamp_string();
        self.persist()?;
        self.audit(AuditAction::SshHostTrusted {
            id: Self::parse_entry_uuid(entry_id)?,
        })?;
        Ok(())
    }

    /// Removes a stored SSH host key fingerprint (user-initiated reset).
    pub fn clear_ssh_known_host_fingerprint(&mut self, entry_id: &str) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        let idx = self
            .entries
            .iter()
            .position(|e| e.id == entry_id)
            .ok_or(VaultError::EntryNotFound)?;

        let entry = &mut self.entries[idx];
        let SecretPayload::SshKey {
            known_host_fingerprint,
            ..
        } = &mut entry.payload
        else {
            return Err(VaultError::Other("entry is not an SSH key".into()));
        };

        *known_host_fingerprint = None;
        entry.updated_at = unix_timestamp_string();
        self.persist()?;
        self.audit(AuditAction::SecretModified {
            id: Self::parse_entry_uuid(entry_id)?,
        })?;
        Ok(())
    }

    pub fn audit_security(&self) -> Result<SecurityAuditReport, VaultError> {
        self.ensure_unlocked()?;
        Ok(audit_entries(&self.entries))
    }

    /// Re-encrypts the master-key container under a new password without decrypting payload blocks.
    pub fn reencrypt_vault(
        &mut self,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), VaultError> {
        self.ensure_unlocked()?;

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        crate::lock::assert_vault_write_access(&path, self.vault_lock.as_ref())?;
        self.verify_current_password(current_password)?;

        validate_master_password_with_min_len(new_password, effective_min_master_password_len())?;

        let dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        let new_salt = crypto::random_salt();
        let new_kek = MasterKey::derive_from_password(new_password, &new_salt, self.kdf)?;
        let now = crate::compliance::unix_timestamp_secs();
        let created = self.key_created_at.unwrap_or(now);

        format::rotate_vault_key_container(
            &path, &self.name, self.kdf, &new_salt, &new_kek, dek, created, now,
        )?;

        self.salt = Some(new_salt);
        self.kek = Some(new_kek);
        self.format_version = format::FORMAT_VERSION_V2;
        self.key_created_at = Some(created);
        self.key_rotated_at = Some(now);
        self.audit(AuditAction::VaultKeyRotated)?;
        Ok(())
    }

    fn verify_current_password(&self, current_password: &str) -> Result<(), VaultError> {
        let salt = self.salt.ok_or(VaultError::NotInitialized)?;
        let candidate = MasterKey::derive_from_password(current_password, &salt, self.kdf)?;
        let dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;

        match self.format_version {
            format::FORMAT_VERSION_V2 => {
                let kek = self.kek.as_ref().ok_or(VaultError::Locked)?;
                if candidate.as_bytes() != kek.as_bytes() {
                    return Err(VaultError::InvalidPassword);
                }
            }
            _ => {
                if candidate.as_bytes() != dek.as_bytes() {
                    return Err(VaultError::InvalidPassword);
                }
            }
        }

        Ok(())
    }

    pub fn compliance_status(&self) -> Result<crate::compliance::ComplianceStatus, VaultError> {
        let path = self.path.as_ref().ok_or(VaultError::NoVaultFile)?;
        let checkpoints_applicable = !self.locked;
        let audit_key = if self.locked {
            None
        } else {
            self.audit_hmac_key
                .as_ref()
                .map(|key| key.as_ref() as &[u8])
        };
        crate::compliance::compliance_status(
            path,
            self.format_version,
            audit_key,
            checkpoints_applicable,
        )
    }

    /// Re-reads the vault file from disk after an external change (e.g. Git pull).
    pub fn reload_from_disk(&mut self) -> Result<(), VaultError> {
        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        if self.locked {
            return self.attach_locked(path);
        }

        if format::is_multi_user_format(self.format_version) {
            let current_user = self.current_user.as_ref().ok_or(VaultError::Locked)?;
            let dek = MasterKey::from_bytes(current_user.dek);

            let file = format::read_multi_user_vault_file(&path)?;
            let payload = format::decrypt_multi_user_payload(
                &dek,
                &file.payload_nonce,
                &file.payload_ciphertext,
                file.format_version,
                &file.header_aad,
            )?;

            let meta = format::read_vault_meta(&path)?;
            let key_created_at = effective_key_created_at(&meta, &path);
            let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);

            self.name = meta.name;
            self.key_created_at = Some(key_created_at);
            self.key_rotated_at = key_rotated_at;
            self.users = file.users;
            self.format_version = meta.format_version;
            self.apply_payload(payload);
            self.cached_entry_count = self.entries.len();
            return Ok(());
        }

        let kek = self.kek.as_ref().ok_or(VaultError::Locked)?;
        let meta = format::read_vault_meta(&path)?;
        let key_created_at = effective_key_created_at(&meta, &path);
        let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);
        let (_, payload) = format::read_vault_file(&path, kek)?;

        self.name = meta.name;
        self.format_version = meta.format_version;
        self.key_created_at = Some(key_created_at);
        self.key_rotated_at = key_rotated_at;
        self.apply_payload(payload);
        self.cached_entry_count = self.entries.len();
        Ok(())
    }

    /// Returns whether the vault is loaded and unlocked.
    pub fn is_unlocked(&self) -> bool {
        !self.locked
    }

    /// Starts TOTP enrollment — generates secret + QR (vault must be unlocked).
    pub fn begin_mfa_enrollment(&mut self) -> Result<MfaSetupInfo, VaultError> {
        self.ensure_unlocked()?;
        if self.mfa.as_ref().is_some_and(|config| config.enabled) {
            return Err(VaultError::Other("MFA is already enabled".into()));
        }

        let enrollment = mfa::create_enrollment(&self.name)?;
        self.pending_mfa_secret = Some(enrollment.secret_bytes);
        Ok(enrollment.info)
    }

    /// Verifies a TOTP code; finalizes enrollment when a pending secret exists.
    pub fn verify_mfa_code(&mut self, code: &str) -> Result<bool, VaultError> {
        self.ensure_unlocked()?;

        let secret_bytes = if let Some(pending) = self.pending_mfa_secret.as_ref() {
            Zeroizing::new(pending.to_vec())
        } else if let Some(stored) = self.mfa.as_ref().filter(|config| config.enabled) {
            let payload_key = self.master_key.as_ref().ok_or(VaultError::Locked)?;
            mfa::decrypt_mfa_secret(payload_key, stored)?
        } else {
            return Err(VaultError::Other(
                "MFA enrollment has not been started".into(),
            ));
        };

        let valid = mfa::verify_totp_code(secret_bytes.as_ref(), &self.name, code)?;
        if !valid {
            return Ok(false);
        }

        if self.pending_mfa_secret.is_some() {
            let pending = self
                .pending_mfa_secret
                .take()
                .ok_or(VaultError::Other("MFA enrollment state lost".into()))?;
            let payload_key = self.master_key.as_ref().ok_or(VaultError::Locked)?;
            self.mfa = Some(mfa::encrypt_mfa_secret(payload_key, pending.as_ref())?);
            self.persist()?;
            self.audit(AuditAction::ConfigChanged {
                area: "mfa_enabled".into(),
            })?;
        }

        Ok(true)
    }

    /// Returns whether TOTP MFA is active for the current vault session.
    pub fn mfa_status(&self) -> MfaStatus {
        if self.is_v3() {
            return MfaStatus {
                mfa_enabled: self.current_user_has_mfa(),
                vault_locked: self.locked,
            };
        }
        MfaStatus {
            mfa_enabled: self.mfa.as_ref().is_some_and(|config| config.enabled),
            vault_locked: self.locked,
        }
    }

    /// Disables MFA and removes the encrypted secret from the vault payload.
    pub fn disable_mfa(&mut self) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        if !self.mfa.as_ref().is_some_and(|config| config.enabled) {
            return Err(VaultError::Other("MFA is not enabled".into()));
        }
        self.mfa = None;
        self.pending_mfa_secret = None;
        self.persist()?;
        self.audit(AuditAction::ConfigChanged {
            area: "mfa_disabled".into(),
        })?;
        Ok(())
    }

    fn apply_payload(&mut self, payload: format::VaultPayload) {
        self.entries = payload.entries;
        self.mfa = payload.mfa;
        self.cached_entry_count = self.entries.len();
    }

    fn apply_unlock_handle(
        &mut self,
        handle: auth::VaultHandle,
        audit: UnlockAuditAction,
    ) -> Result<(), VaultError> {
        self.master_key = Some(handle.payload_key);
        self.kek = Some(handle.kek);
        self.key_created_at = Some(handle.key_created_at);
        self.key_rotated_at = handle.key_rotated_at;
        self.format_version = handle.meta.format_version;
        self.apply_payload(handle.payload);
        self.locked = false;
        match audit {
            UnlockAuditAction::Opened => self.audit(AuditAction::VaultOpened)?,
            UnlockAuditAction::Unlocked { lock_id } => {
                self.audit(AuditAction::VaultUnlocked { lock_id })?
            }
        }
        self.establish_audit_session()?;
        Ok(())
    }

    pub fn format_version(&self) -> u16 {
        self.format_version
    }

    pub fn is_multi_user_vault(&self) -> bool {
        format::is_multi_user_format(self.format_version)
    }

    /// Returns true when the loaded vault uses format v3 (multi-user).
    pub fn is_v3(&self) -> bool {
        self.is_multi_user_vault()
    }

    /// Returns whether the current v3 user has MFA enabled in the header.
    pub fn current_user_has_mfa(&self) -> bool {
        let username = match self.current_user.as_ref() {
            Some(user) => user.username.as_str(),
            None => return false,
        };
        self.users
            .iter()
            .find(|user| user.username == username)
            .is_some_and(user_mfa_enabled)
    }

    fn store_session_kek(&mut self, kek: &MasterKey) {
        self.session_kek = Some(Zeroizing::new(*kek.as_bytes()));
    }

    fn session_kek_master_key(&self) -> Result<MasterKey, VaultError> {
        let bytes = self.session_kek.as_ref().ok_or(VaultError::Locked)?;
        Ok(MasterKey::from_bytes(**bytes))
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn audit_session_hmac_key(&self) -> Option<&[u8; 32]> {
        self.audit_hmac_key.as_deref()
    }

    fn persist_v3_header(&mut self) -> Result<(), VaultError> {
        self.persist()
    }

    pub fn get_current_user_public(&self) -> Option<VaultUserPublic> {
        let username = self.current_user.as_ref()?.username.clone();
        self.users
            .iter()
            .find(|user| user.username == username)
            .map(|user| to_public(user, true))
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
            is_multi_user: self.is_multi_user_vault(),
        }
    }

    fn ensure_unlocked(&self) -> Result<(), VaultError> {
        if self.locked {
            Err(VaultError::Locked)
        } else {
            Ok(())
        }
    }

    fn persist(&mut self) -> Result<(), VaultError> {
        let path = self.path.as_ref().ok_or(VaultError::NoVaultFile)?;
        let payload_key = self.master_key.as_ref().ok_or(VaultError::Locked)?;

        if format::is_multi_user_format(self.format_version) {
            format::update_v3_vault_file(
                path,
                &self.name,
                &self.users,
                payload_key,
                &self.entries,
                self.key_created_at.unwrap_or(0),
                self.key_rotated_at.unwrap_or(0),
            )?;
            self.format_version = format::FORMAT_VERSION_V4;
            return Ok(());
        }

        let salt = self.salt.ok_or(VaultError::NotInitialized)?;
        format::update_vault_file_payload(
            path,
            &self.name,
            self.kdf,
            &salt,
            payload_key,
            self.kek.as_ref(),
            self.format_version,
            self.key_created_at.unwrap_or(0),
            self.key_rotated_at.unwrap_or(0),
            format::VaultPersistPayload {
                entries: &self.entries,
                mfa: self.mfa.as_ref(),
            },
        )
    }

    /// Creates a new v3 multi-user vault with the first admin user.
    pub fn create_v3(
        path: &Path,
        vault_name: &str,
        admin_username: &str,
        admin_password: Zeroizing<String>,
    ) -> Result<Self, VaultError> {
        let path = normalize_vault_path(path)?;
        if path.exists() {
            return Err(VaultError::FileExists);
        }

        let dek = MasterKey::generate_data_key();
        let admin_user = build_vault_user(
            admin_username,
            admin_password.clone(),
            UserRole::Admin,
            &dek,
            None,
        )?;
        let session_kek = derive_user_kek(&admin_user, admin_password.as_str())?;
        let users = vec![admin_user.clone()];
        let key_created_at = crate::compliance::unix_timestamp_secs();

        format::write_v3_vault_file(path.as_path(), vault_name, &users, dek.as_bytes(), &[])?;

        let mut vault = Self::new();
        vault.path = Some(path.clone());
        vault.name = vault_name.to_string();
        vault.format_version = format::FORMAT_VERSION_V4;
        vault.key_created_at = Some(key_created_at);
        vault.key_rotated_at = None;
        vault.users = users;
        vault.master_key = Some(dek);
        vault.store_session_kek(&session_kek);
        vault.current_user = Some(UnlockedUser {
            username: admin_user.username,
            role: UserRole::Admin,
            dek: *vault.master_key.as_ref().expect("dek").as_bytes(),
        });
        vault.locked = false;
        vault.bind_audit_logger(&path)?;
        vault.audit(AuditAction::VaultCreated)?;
        vault.establish_audit_session()?;
        Ok(vault)
    }
    pub fn unlock_as_user(
        &mut self,
        username: &str,
        password: Zeroizing<String>,
        mfa_code: Option<&str>,
    ) -> Result<UnlockStep, VaultError> {
        if !format::is_multi_user_format(self.format_version) {
            return Err(VaultError::Other("vault is not multi-user format".into()));
        }

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        if self.vault_lock.is_none() {
            self.acquire_vault_lock(&path)?;
        }
        let lock_meta = self.assert_lock_valid()?;

        let username = validate_username(username)?;
        let user = self
            .users
            .iter()
            .find(|candidate| candidate.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?
            .clone();

        let kek = derive_user_kek(&user, password.as_str())
            .map_err(|_| VaultError::InvalidUserPassword)?;
        let dek = unwrap_user_dek(&user, &kek).map_err(|_| VaultError::InvalidUserPassword)?;

        if user_mfa_enabled(&user) {
            let Some(code) = mfa_code else {
                return Ok(UnlockStep::MfaRequired);
            };
            let (nonce, ciphertext) = (
                user.mfa_nonce.as_deref().unwrap_or_default(),
                user.mfa_ciphertext.as_deref().unwrap_or_default(),
            );
            let secret = mfa::decrypt_mfa_secret_with_kek(&kek, nonce, ciphertext)?;
            let account = mfa::v3_user_totp_account(&self.name, &username);
            let valid = mfa::verify_totp_code_for_account(secret.as_ref(), &account, code)?;
            if !valid {
                let _ = self.record_auth_failed();
                return Err(VaultError::InvalidMfaCode);
            }
        }

        let file = format::read_multi_user_vault_file(&path)?;
        let payload = format::decrypt_multi_user_payload(
            &dek,
            &file.payload_nonce,
            &file.payload_ciphertext,
            file.format_version,
            &file.header_aad,
        )?;

        self.master_key = Some(dek);
        self.store_session_kek(&kek);
        self.current_user = Some(UnlockedUser {
            username: username.clone(),
            role: user.role,
            dek: *self.master_key.as_ref().expect("dek").as_bytes(),
        });
        self.apply_payload(payload);
        self.cached_entry_count = self.entries.len();
        self.format_version = file.format_version;
        self.locked = false;
        self.audit(AuditAction::VaultUnlocked {
            lock_id: lock_meta.lock_id(),
        })?;
        self.establish_audit_session()?;
        Ok(UnlockStep::Complete)
    }
    pub fn add_user(
        &mut self,
        new_username: &str,
        new_password: Zeroizing<String>,
        role: UserRole,
    ) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        self.ensure_admin()?;

        let new_username = validate_username(new_username)?;
        if self.users.iter().any(|user| user.username == new_username) {
            return Err(VaultError::UserAlreadyExists(new_username));
        }

        let dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        let new_user = build_vault_user(new_username.as_str(), new_password, role, dek, None)?;
        self.users.push(new_user);
        self.persist()?;
        self.audit(AuditAction::UserAdded {
            username: new_username,
        })
    }

    /// Removes a user (requires Admin; cannot remove self).
    pub fn remove_user(&mut self, username: &str) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        self.ensure_admin()?;

        let username = validate_username(username)?;
        let current = self
            .current_user
            .as_ref()
            .ok_or(VaultError::Locked)?
            .username
            .clone();
        if username == current {
            return Err(VaultError::InsufficientPermissions);
        }

        let admin_count = self
            .users
            .iter()
            .filter(|user| user.role == UserRole::Admin)
            .count();
        let target_is_admin = self
            .users
            .iter()
            .find(|user| user.username == username)
            .is_some_and(|user| user.role == UserRole::Admin);
        if target_is_admin && admin_count <= 1 {
            return Err(VaultError::LastAdminCannotBeRemoved);
        }

        let before = self.users.len();
        self.users.retain(|user| user.username != username);
        if self.users.len() == before {
            return Err(VaultError::UserNotFound(username.clone()));
        }

        self.persist()?;
        self.audit(AuditAction::UserRemoved { username })
    }

    /// Changes the current user's password (rewraps their DEK entry only).
    pub fn change_own_password(
        &mut self,
        current_password: Zeroizing<String>,
        new_password: Zeroizing<String>,
    ) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        if !format::is_multi_user_format(self.format_version) {
            return Err(VaultError::Other("vault is not multi-user format".into()));
        }

        let username = self
            .current_user
            .as_ref()
            .ok_or(VaultError::Locked)?
            .username
            .clone();
        let idx = self
            .users
            .iter()
            .position(|user| user.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?;

        let dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;
        rewrap_user_dek(
            &mut self.users[idx],
            current_password,
            new_password.clone(),
            dek,
        )?;
        let new_kek = derive_user_kek(&self.users[idx], new_password.as_str())?;
        self.store_session_kek(&new_kek);
        self.persist()?;
        self.audit(AuditAction::UserPasswordChanged { username })
    }

    /// Enables MFA for the current v3 user (persisted immediately in the header).
    pub fn enable_mfa_for_current_user(&mut self) -> Result<MfaSetupInfo, VaultError> {
        self.ensure_unlocked()?;
        if !self.is_v3() {
            return Err(VaultError::Other("vault is not multi-user format".into()));
        }

        let username = self
            .current_user
            .as_ref()
            .ok_or(VaultError::Locked)?
            .username
            .clone();
        let user = self
            .users
            .iter()
            .find(|candidate| candidate.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?;
        if user_mfa_enabled(user) {
            return Err(VaultError::Other("MFA is already enabled".into()));
        }

        let kek = self.session_kek_master_key()?;
        let enrollment = mfa::create_enrollment_for_v3_user(&self.name, &username)?;
        let (mfa_nonce, mfa_ciphertext) =
            mfa::encrypt_mfa_secret_with_kek(&kek, enrollment.secret_bytes.as_ref())?;

        let idx = self
            .users
            .iter()
            .position(|user| user.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?;
        self.users[idx].mfa_nonce = Some(mfa_nonce);
        self.users[idx].mfa_ciphertext = Some(mfa_ciphertext);
        self.persist_v3_header()?;
        self.audit(AuditAction::UserMfaEnabled { username })?;
        Ok(enrollment.info)
    }

    /// Verifies a TOTP code for the current v3 user (UI check after enrollment).
    pub fn verify_mfa_code_for_current_user(&self, code: &str) -> Result<bool, VaultError> {
        if !self.is_v3() {
            return Err(VaultError::Other("vault is not multi-user format".into()));
        }

        let username = self
            .current_user
            .as_ref()
            .ok_or(VaultError::Locked)?
            .username
            .clone();
        let user = self
            .users
            .iter()
            .find(|candidate| candidate.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?;
        if !user_mfa_enabled(user) {
            return Err(VaultError::Other("MFA is not enabled".into()));
        }

        let kek = self.session_kek_master_key()?;
        let (nonce, ciphertext) = (
            user.mfa_nonce.as_deref().unwrap_or_default(),
            user.mfa_ciphertext.as_deref().unwrap_or_default(),
        );
        let secret = mfa::decrypt_mfa_secret_with_kek(&kek, nonce, ciphertext)?;
        let account = mfa::v3_user_totp_account(&self.name, &username);
        mfa::verify_totp_code_for_account(secret.as_ref(), &account, code)
    }

    /// Disables MFA for the current v3 user.
    pub fn disable_mfa_for_current_user(&mut self) -> Result<(), VaultError> {
        self.ensure_unlocked()?;
        let username = self
            .current_user
            .as_ref()
            .ok_or(VaultError::Locked)?
            .username
            .clone();
        let idx = self
            .users
            .iter()
            .position(|user| user.username == username)
            .ok_or_else(|| VaultError::UserNotFound(username.clone()))?;

        if !user_mfa_enabled(&self.users[idx]) {
            return Err(VaultError::Other("MFA is not enabled".into()));
        }

        self.users[idx].mfa_nonce = None;
        self.users[idx].mfa_ciphertext = None;
        self.persist_v3_header()?;
        self.audit(AuditAction::UserMfaDisabled { username })
    }

    /// Lists vault users (IPC-safe — no secrets).
    pub fn list_users(&self) -> Vec<VaultUserPublic> {
        let current = self
            .current_user
            .as_ref()
            .map(|user| user.username.as_str());
        self.users
            .iter()
            .map(|user| to_public(user, current == Some(user.username.as_str())))
            .collect()
    }

    /// Migrates a v1/v2 single-password vault to v3 multi-user format.
    pub fn migrate_to_v3(
        &mut self,
        current_password: Zeroizing<String>,
        admin_username: &str,
    ) -> Result<(), VaultError> {
        if format::is_multi_user_format(self.format_version) {
            return Err(VaultError::Other(
                "vault is already multi-user format".into(),
            ));
        }

        self.verify_current_password(current_password.as_str())?;
        self.ensure_unlocked()?;

        let admin_username = validate_username(admin_username)?;
        if self
            .users
            .iter()
            .any(|user| user.username == admin_username)
        {
            return Err(VaultError::UserAlreadyExists(admin_username.clone()));
        }

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        crate::lock::assert_vault_write_access(&path, self.vault_lock.as_ref())?;

        let new_dek = MasterKey::generate_data_key();
        let mut admin_user = build_vault_user(
            &admin_username,
            current_password.clone(),
            UserRole::Admin,
            &new_dek,
            None,
        )?;

        if let Some(stored_mfa) = self.mfa.take().filter(|config| config.enabled) {
            let old_dek = self.master_key.as_ref().ok_or(VaultError::Locked)?;
            let secret = mfa::decrypt_mfa_secret(old_dek, &stored_mfa)?;
            let kek = derive_user_kek(&admin_user, current_password.as_str())?;
            let (mfa_nonce, mfa_ciphertext) =
                mfa::encrypt_mfa_secret_with_kek(&kek, secret.as_ref())?;
            admin_user.mfa_nonce = Some(mfa_nonce);
            admin_user.mfa_ciphertext = Some(mfa_ciphertext);
        }

        let entries = self.entries.clone();
        let key_created_at = self
            .key_created_at
            .unwrap_or_else(crate::compliance::unix_timestamp_secs);
        let key_rotated_at = self.key_rotated_at.unwrap_or(0);

        format::update_v3_vault_file(
            &path,
            &self.name,
            std::slice::from_ref(&admin_user),
            &new_dek,
            &entries,
            key_created_at,
            key_rotated_at,
        )?;

        let session_kek = derive_user_kek(&admin_user, current_password.as_str())?;
        self.users = vec![admin_user];
        self.master_key = Some(new_dek);
        self.store_session_kek(&session_kek);
        self.current_user = Some(UnlockedUser {
            username: admin_username.clone(),
            role: UserRole::Admin,
            dek: *self.master_key.as_ref().expect("dek").as_bytes(),
        });
        self.format_version = format::FORMAT_VERSION_V4;
        self.salt = None;
        self.kek = None;
        self.mfa = None;
        self.pending_mfa_secret = None;
        self.entries = entries;
        self.cached_entry_count = self.entries.len();
        self.audit(AuditAction::VaultMigratedToV3 { admin_username })
    }

    fn ensure_admin(&self) -> Result<(), VaultError> {
        match self.current_user.as_ref().map(|user| &user.role) {
            Some(UserRole::Admin) => Ok(()),
            _ => Err(VaultError::InsufficientPermissions),
        }
    }
}

fn merge_ssh_known_host_on_update(existing: &SecretPayload, incoming: &mut SecretPayload) {
    let (
        SecretPayload::SshKey {
            known_host_fingerprint: existing_fp,
            ..
        },
        SecretPayload::SshKey {
            known_host_fingerprint: incoming_fp,
            ..
        },
    ) = (existing, incoming)
    else {
        return;
    };

    if incoming_fp.is_none() {
        *incoming_fp = existing_fp.clone();
    }
}

fn unix_timestamp_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn effective_key_created_at(meta: &format::VaultFileMeta, path: &std::path::Path) -> u64 {
    if meta.key_created_at > 0 {
        return meta.key_created_at;
    }
    if meta.format_version == format::FORMAT_VERSION_V1 {
        return std::fs::metadata(path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
    }
    0
}

fn effective_min_master_password_len() -> usize {
    admin_policy()
        .min_master_password_len
        .map(|value| value as usize)
        .unwrap_or(MIN_MASTER_PASSWORD_LEN)
}

impl Drop for Vault {
    fn drop(&mut self) {
        let _ = self.release_vault_lock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{SecretEntryInput, SecretPayload};
    use tempfile::tempdir;

    fn open_vault(vault: &mut Vault, path: &Path, password: &str, mfa_code: Option<&str>) {
        let step = vault.open(path, password, mfa_code).expect("open vault");
        assert_eq!(step, UnlockStep::Complete);
    }

    fn unlock_vault(vault: &mut Vault, password: &str, mfa_code: Option<&str>) {
        let step = vault.unlock(password, mfa_code).expect("unlock vault");
        assert_eq!(step, UnlockStep::Complete);
    }

    fn totp_token_for(vault: &Vault, account: &str) -> String {
        let totp = totp_rs::TOTP::new(
            totp_rs::Algorithm::SHA1,
            6,
            1,
            30,
            vault
                .pending_mfa_secret
                .as_ref()
                .expect("pending secret")
                .to_vec(),
            Some("OxidVault".to_string()),
            account.to_string(),
        )
        .expect("totp");
        totp.generate_current().expect("token")
    }

    #[test]
    fn reencrypt_vault_rotates_master_key_container() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "RotateMe", "correct-horse-battery-staple")
            .unwrap();

        vault
            .reencrypt_vault(
                "correct-horse-battery-staple",
                "brand-new-horse-battery-staple",
            )
            .expect("rotate");

        vault.lock();

        let mut reopened = Vault::new();
        open_vault(&mut reopened, &path, "brand-new-horse-battery-staple", None);
        assert_eq!(reopened.list_entries().unwrap().len(), 0);

        let log_path = crate::audit::audit_log_path(&path);
        let raw = std::fs::read_to_string(log_path).unwrap();
        assert!(raw.contains("[VaultKeyRotated]"));
    }

    #[test]
    fn reencrypt_vault_fails_when_lock_held_by_other_instance() {
        use crate::lock::{lock_path_for, LockMetadata};

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let password = "correct-horse-battery-staple";

        let mut vault = Vault::new();
        vault.create(&path, "SharedVault", password).unwrap();

        let foreign = LockMetadata {
            user: "other-user".into(),
            pid: 9_999_999,
            host: "other-host".into(),
        };
        std::fs::write(
            lock_path_for(&path),
            serde_json::to_string_pretty(&foreign).unwrap(),
        )
        .unwrap();

        let err = vault
            .reencrypt_vault(password, "another-strong-password-1")
            .expect_err("foreign lock holder");
        assert!(matches!(err, VaultError::LockedBy(_)));
    }

    #[test]
    fn reencrypt_vault_audit_event_appears_in_json_export() {
        use crate::audit_export::{export_audit_report, ExportFormat};

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let old_password = "correct-horse-battery-staple";
        let new_password = "rotation-export-test-pw";

        let mut vault = Vault::new();
        vault.create(&path, "ExportVault", old_password).unwrap();
        vault
            .reencrypt_vault(old_password, new_password)
            .expect("rotate");

        let export_path = dir.path().join("audit-export.json");
        export_audit_report(path.clone(), export_path.clone(), ExportFormat::Json)
            .expect("export audit");

        let raw = std::fs::read_to_string(export_path).unwrap();
        assert!(raw.contains("VaultKeyRotated"));
        assert!(raw.contains("\"chainVerified\": true"));
    }

    #[test]
    fn reencrypt_vault_rejects_wrong_current_password() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "RotateMe", "correct-horse-battery-staple")
            .unwrap();

        let err = vault
            .reencrypt_vault("wrong-password-here", "brand-new-horse-battery-staple")
            .expect_err("wrong current password");
        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn attach_locked_then_unlock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();
        vault.lock();

        let mut cold = Vault::new();
        cold.attach_locked(&path).unwrap();
        assert!(cold.info().locked);
        assert!(cold.info().initialized);
        assert_eq!(cold.info().name, "TestVault");

        unlock_vault(&mut cold, "correct-horse-battery-staple", None);
        assert!(!cold.info().locked);
    }

    #[test]
    fn create_add_lock_unlock() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();
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
                    known_host_fingerprint: None,
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
        unlock_vault(&mut vault2, "correct-horse-battery-staple", None);
        assert_eq!(vault2.list_entries().unwrap().len(), 1);
    }

    #[test]
    fn update_entry_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();

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
        unlock_vault(&mut vault2, "correct-horse-battery-staple", None);
        let reloaded = vault2.get_entry_public(&summary.id).unwrap();
        assert_eq!(reloaded.title, "GitHub Prod");
    }

    #[test]
    fn delete_entry_hard_removes_and_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();

        let summary = vault
            .add_entry(SecretEntryInput {
                title: "To Delete".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::WebLogin {
                    url: "https://example.com".into(),
                    username: "user".into(),
                    password: "secret-to-purge".into(),
                    notes: None,
                },
            })
            .unwrap();

        let keep = vault
            .add_entry(SecretEntryInput {
                title: "Keep".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::ApiToken {
                    service: "svc".into(),
                    token: "tok".into(),
                },
            })
            .unwrap();

        vault.delete_entry(&summary.id).unwrap();
        assert_eq!(vault.list_entries().unwrap().len(), 1);
        assert!(vault.get_entry_public(&summary.id).is_err());
        assert!(vault.get_entry_public(&keep.id).is_ok());

        vault.lock();
        let mut vault2 = Vault::new();
        vault2.path = Some(path);
        vault2.name = "TestVault".into();
        vault2.locked = true;
        unlock_vault(&mut vault2, "correct-horse-battery-staple", None);
        assert_eq!(vault2.list_entries().unwrap().len(), 1);
        assert!(vault2.get_entry_public(&summary.id).is_err());
    }

    #[test]
    fn find_web_login_for_hostname() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();

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

    #[test]
    fn compliance_audit_log_is_written() {
        use crate::audit::{audit_log_path, verify_audit_chain};

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "AuditVault", "correct-horse-battery-staple")
            .unwrap();
        vault.lock();

        let log_path = audit_log_path(&path);
        assert!(log_path.is_file());
        verify_audit_chain(&log_path).expect("valid audit chain");

        let raw = std::fs::read_to_string(&log_path).unwrap();
        assert!(raw.contains("[VaultCreated]"));
        assert!(raw.contains("[VaultLocked]"));
        assert!(raw.contains("entry_hash="));

        let mut vault2 = Vault::new();
        vault2.attach_locked(&path).unwrap();
        unlock_vault(&mut vault2, "correct-horse-battery-staple", None);
        let raw2 = std::fs::read_to_string(&log_path).unwrap();
        assert!(raw2.contains("[VaultUnlocked]"));
        let lock_id = format!(
            "{}@{}:{}",
            std::env::var("USERNAME")
                .or_else(|_| std::env::var("USER"))
                .unwrap_or_else(|_| "unknown".into()),
            sysinfo::System::host_name().unwrap_or_else(|| "unknown".into()),
            std::process::id()
        );
        assert!(
            raw2.contains(&format!("[{lock_id}]")),
            "VaultUnlocked must reference active lock id"
        );
    }

    #[test]
    fn open_acquires_exclusive_lock() {
        use crate::lock::lock_path_for;

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut owner = Vault::new();
        owner
            .create(&path, "LockVault", "correct-horse-battery-staple")
            .unwrap();
        owner.lock();
        open_vault(&mut owner, &path, "correct-horse-battery-staple", None);
        assert!(lock_path_for(&path).is_file());

        let mut blocked = Vault::new();
        let err = blocked
            .open(&path, "correct-horse-battery-staple", None)
            .expect_err("lock held by owner");
        assert!(matches!(err, VaultError::LockedBy(_)));

        drop(owner);
        assert!(!lock_path_for(&path).is_file());

        let mut next = Vault::new();
        open_vault(&mut next, &path, "correct-horse-battery-staple", None);
        next.close().unwrap();
        assert!(!lock_path_for(&path).is_file());
    }

    #[test]
    fn unlock_fails_if_lock_is_deleted_manually() {
        use crate::lock::lock_path_for;

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "TestVault", "correct-horse-battery-staple")
            .unwrap();
        vault.lock();

        let mut session = Vault::new();
        session.attach_locked(&path).unwrap();
        assert!(lock_path_for(&path).is_file());

        std::fs::remove_file(lock_path_for(&path)).expect("simulate external lock deletion");

        let err = session
            .unlock("correct-horse-battery-staple", None)
            .expect_err("unlock must refuse without valid lock");
        assert!(matches!(err, VaultError::LockLost));
        assert!(session.info().locked);
    }

    #[test]
    fn mfa_enrollment_persists_after_verification() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "MfaVault", "correct-horse-battery-staple")
            .unwrap();

        let setup = vault.begin_mfa_enrollment().expect("enrollment");
        let totp = totp_rs::TOTP::new(
            totp_rs::Algorithm::SHA1,
            6,
            1,
            30,
            vault
                .pending_mfa_secret
                .as_ref()
                .expect("pending secret")
                .to_vec(),
            Some("OxidVault".to_string()),
            "MfaVault".to_string(),
        )
        .expect("totp");
        let token = totp.generate_current().expect("token");

        assert!(vault.verify_mfa_code(&token).expect("verify"));
        assert!(vault.mfa.as_ref().is_some_and(|config| config.enabled));
        assert!(vault.pending_mfa_secret.is_none());

        vault.lock();
        let mut reopened = Vault::new();
        let step = reopened
            .open(&path, "correct-horse-battery-staple", None)
            .expect("reopen");
        assert_eq!(step, UnlockStep::MfaRequired);
        assert!(reopened.info().locked);
        let step = reopened
            .open(&path, "correct-horse-battery-staple", Some(&token))
            .expect("complete MFA unlock");
        assert_eq!(step, UnlockStep::Complete);
        assert!(reopened.mfa.as_ref().is_some_and(|config| config.enabled));
        assert!(reopened.verify_mfa_code(&token).expect("verify persisted"));
        assert_eq!(setup.account_label, "OxidVault:MfaVault");
    }

    #[test]
    fn mfa_blocks_unlock_until_valid_totp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let password = "correct-horse-battery-staple";

        let mut vault = Vault::new();
        vault.create(&path, "MfaVault", password).unwrap();
        let _setup = vault.begin_mfa_enrollment().expect("enrollment");
        let token = totp_token_for(&vault, "MfaVault");
        assert!(vault.verify_mfa_code(&token).expect("verify enrollment"));

        vault.lock();
        let mut session = Vault::new();
        session.attach_locked(&path).unwrap();

        let step = session.unlock(password, None).expect("password accepted");
        assert_eq!(step, UnlockStep::MfaRequired);
        assert!(session.info().locked);
        assert!(session.list_entries().is_err());

        let err = session
            .unlock(password, Some("000000"))
            .expect_err("wrong code");
        assert!(matches!(err, VaultError::InvalidMfaCode));
        assert!(session.info().locked);

        let step = session
            .unlock(password, Some(&token))
            .expect("valid MFA code");
        assert_eq!(step, UnlockStep::Complete);
        assert!(!session.info().locked);
        assert_eq!(session.list_entries().unwrap().len(), 0);
    }

    #[test]
    fn atomic_unlock_vault_requires_mfa_code_when_enabled() {
        use crate::auth::{unlock_vault as authenticate_unlock, AuthError};

        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault = Vault::new();
        vault.create(&path, "MfaVault", password.as_str()).unwrap();
        let _setup = vault.begin_mfa_enrollment().expect("enrollment");
        let token = totp_token_for(&vault, "MfaVault");
        assert!(vault.verify_mfa_code(&token).expect("verify enrollment"));
        vault.lock();

        let err = authenticate_unlock(&path, password.clone(), None).unwrap_err();
        assert!(matches!(err, AuthError::MfaRequired));

        let handle = authenticate_unlock(&path, password.clone(), Some(Zeroizing::new(token)))
            .expect("atomic unlock");
        assert_eq!(handle.meta.name, "MfaVault");
    }

    #[test]
    fn disable_mfa_removes_stored_secret() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        let mut vault = Vault::new();
        vault
            .create(&path, "MfaVault", "correct-horse-battery-staple")
            .unwrap();

        let _setup = vault.begin_mfa_enrollment().expect("enrollment");
        let totp = totp_rs::TOTP::new(
            totp_rs::Algorithm::SHA1,
            6,
            1,
            30,
            vault
                .pending_mfa_secret
                .as_ref()
                .expect("pending secret")
                .to_vec(),
            Some("OxidVault".to_string()),
            "MfaVault".to_string(),
        )
        .expect("totp");
        let token = totp.generate_current().expect("token");
        assert!(vault.verify_mfa_code(&token).expect("verify"));
        assert!(vault.mfa_status().mfa_enabled);

        vault.disable_mfa().expect("disable");
        assert!(!vault.mfa_status().mfa_enabled);

        vault.lock();
        let mut reopened = Vault::new();
        open_vault(&mut reopened, &path, "correct-horse-battery-staple", None);
        assert!(!reopened.mfa_status().mfa_enabled);
    }

    #[test]
    fn v3_create_unlock_and_add_member() {
        use crate::vault_user::UserRole;
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("multi.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault =
            Vault::create_v3(&path, "TeamVault", "admin", admin_password.clone()).unwrap();
        assert_eq!(vault.list_users().len(), 1);
        assert!(!vault.list_users()[0].mfa_enabled);
        assert!(vault.list_users()[0].is_current_user);

        vault
            .add_user(
                "bob",
                Zeroizing::new("member-password-12".to_string()),
                UserRole::Member,
            )
            .unwrap();
        assert_eq!(vault.list_users().len(), 2);

        vault.lock();
        let mut session = Vault::new();
        session.attach_locked(&path).unwrap();
        session
            .unlock_as_user("admin", admin_password, None)
            .expect("unlock");
        assert_eq!(session.list_users().len(), 2);
        assert_eq!(session.format_version, format::FORMAT_VERSION_V4);
    }

    #[test]
    fn migrate_v2_to_v3_preserves_entries() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault = Vault::new();
        vault
            .create(&path, "LegacyVault", password.as_str())
            .unwrap();
        vault
            .add_entry(SecretEntryInput {
                title: "Token".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::ApiToken {
                    service: "API".into(),
                    token: "secret-token".into(),
                },
            })
            .unwrap();

        vault
            .migrate_to_v3(password.clone(), "admin")
            .expect("migrate");

        assert_eq!(vault.format_version, format::FORMAT_VERSION_V4);
        assert_eq!(vault.list_users().len(), 1);
        assert_eq!(vault.list_entries().unwrap().len(), 1);

        vault.lock();
        let mut reopened = Vault::new();
        reopened.attach_locked(&path).unwrap();
        reopened.unlock_as_user("admin", password, None).unwrap();
        assert_eq!(reopened.list_entries().unwrap().len(), 1);

        let log_path = crate::audit::audit_log_path(&path);
        let raw = std::fs::read_to_string(log_path).unwrap();
        assert!(raw.contains("[VaultMigratedToV3]"));
    }

    #[test]
    fn v3_reload_from_disk_preserves_dek_and_refreshes_state() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("reload.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault =
            Vault::create_v3(&path, "ReloadVault", "admin", admin_password.clone()).unwrap();
        vault
            .add_entry(SecretEntryInput {
                title: "Before".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::SecureNote {
                    content: "note-a".into(),
                },
            })
            .unwrap();

        let dek_before = *vault.master_key.as_ref().expect("dek").as_bytes();
        let current_username = vault
            .current_user
            .as_ref()
            .expect("current user")
            .username
            .clone();

        let mut remote_entries = vault.entries.clone();
        remote_entries.push(
            SecretEntry::from_input(SecretEntryInput {
                title: "After Pull".into(),
                folder: None,
                tags: vec![],
                expires_at: None,
                payload: SecretPayload::SecureNote {
                    content: "note-b".into(),
                },
            })
            .unwrap(),
        );

        let mut remote_users = vault.users.clone();
        remote_users.push(
            build_vault_user(
                "carol",
                Zeroizing::new("carol-password-12".to_string()),
                UserRole::Member,
                vault.master_key.as_ref().expect("dek"),
                None,
            )
            .unwrap(),
        );

        format::update_v3_vault_file(
            &path,
            "ReloadVault",
            &remote_users,
            vault.master_key.as_ref().expect("dek"),
            &remote_entries,
            vault.key_created_at.unwrap_or(0),
            vault.key_rotated_at.unwrap_or(0),
        )
        .unwrap();

        vault.reload_from_disk().expect("reload");

        assert!(vault.is_unlocked());
        assert_eq!(
            *vault.master_key.as_ref().expect("dek").as_bytes(),
            dek_before
        );
        assert_eq!(
            vault.current_user.as_ref().expect("current user").dek,
            dek_before
        );
        assert_eq!(
            vault.current_user.as_ref().expect("current user").username,
            current_username
        );
        assert_eq!(vault.list_users().len(), 2);
        assert!(vault
            .list_users()
            .iter()
            .any(|user| user.username == "carol"));
        assert_eq!(vault.list_entries().unwrap().len(), 2);
        assert!(vault
            .list_entries()
            .unwrap()
            .iter()
            .any(|entry| entry.title == "After Pull"));
    }

    #[test]
    fn v3_reload_from_disk_requires_current_user() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("locked-reload.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault = Vault::create_v3(&path, "LockedReload", "admin", admin_password).unwrap();
        vault.current_user = None;

        let err = vault.reload_from_disk().unwrap_err();
        assert!(matches!(err, VaultError::Locked));
    }

    fn v3_totp_token_for(vault: &Vault, username: &str) -> String {
        use totp_rs::{Algorithm, TOTP};

        let user = vault
            .users
            .iter()
            .find(|user| user.username == username)
            .expect("user");
        let kek = MasterKey::from_bytes(**vault.session_kek.as_ref().expect("session kek"));
        let secret = mfa::decrypt_mfa_secret_with_kek(
            &kek,
            user.mfa_nonce.as_deref().unwrap(),
            user.mfa_ciphertext.as_deref().unwrap(),
        )
        .expect("decrypt mfa");
        let account = mfa::v3_user_totp_account(&vault.name, username);
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret.to_vec(),
            Some("OxidVault".to_string()),
            account,
        )
        .expect("totp");
        totp.generate_current().expect("token")
    }

    #[test]
    fn v3_enable_mfa_stores_in_user_entry_not_payload() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("mfa-enable.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault =
            Vault::create_v3(&path, "MfaVault", "admin", admin_password.clone()).unwrap();
        let setup = vault.enable_mfa_for_current_user().expect("enable mfa");
        assert!(setup.account_label.contains("MfaVault"));
        assert!(setup.account_label.contains("admin"));

        let admin = vault
            .users
            .iter()
            .find(|user| user.username == "admin")
            .expect("admin");
        assert!(admin.mfa_ciphertext.is_some());

        let file = format::read_multi_user_vault_file(&path).unwrap();
        let dek = vault.master_key.as_ref().expect("dek");
        let payload = format::decrypt_multi_user_payload(
            dek,
            &file.payload_nonce,
            &file.payload_ciphertext,
            file.format_version,
            &file.header_aad,
        )
        .unwrap();
        assert!(payload.mfa.is_none());

        let token = v3_totp_token_for(&vault, "admin");
        assert!(vault
            .verify_mfa_code_for_current_user(&token)
            .expect("verify"));
    }

    #[test]
    fn v3_disable_mfa_clears_user_entry() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("mfa-disable.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault = Vault::create_v3(&path, "MfaVault", "admin", admin_password).unwrap();
        vault.enable_mfa_for_current_user().expect("enable");
        vault.disable_mfa_for_current_user().expect("disable");

        let admin = vault
            .users
            .iter()
            .find(|user| user.username == "admin")
            .expect("admin");
        assert!(admin.mfa_nonce.is_none());
        assert!(admin.mfa_ciphertext.is_none());
        assert!(!vault.current_user_has_mfa());
    }

    #[test]
    fn v3_unlock_requires_mfa_when_enabled() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("mfa-unlock.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault =
            Vault::create_v3(&path, "MfaVault", "admin", admin_password.clone()).unwrap();
        vault.enable_mfa_for_current_user().expect("enable");
        let token = v3_totp_token_for(&vault, "admin");
        vault.lock();

        let mut session = Vault::new();
        session.attach_locked(&path).unwrap();
        let step = session
            .unlock_as_user("admin", admin_password.clone(), None)
            .expect("mfa required step");
        assert_eq!(step, UnlockStep::MfaRequired);

        let err = session
            .unlock_as_user("admin", admin_password.clone(), Some("000000"))
            .unwrap_err();
        assert!(matches!(err, VaultError::InvalidMfaCode));

        let step = session
            .unlock_as_user("admin", admin_password, Some(&token))
            .expect("unlock with mfa");
        assert_eq!(step, UnlockStep::Complete);
        assert!(session.current_user_has_mfa());
    }

    #[test]
    fn v3_session_kek_zeroed_on_lock() {
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("session-kek.oxid");
        let admin_password = Zeroizing::new("correct-horse-battery-staple".to_string());

        let mut vault = Vault::create_v3(&path, "KekVault", "admin", admin_password).unwrap();
        assert!(vault.session_kek.is_some());
        vault.lock();
        assert!(vault.session_kek.is_none());
    }
}
