// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

use crate::audit::{AuditAction, AuditLogger};
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
    audit_logger: AuditLogger,
    vault_lock: Option<VaultLock>,
    format_version: u16,
    key_created_at: Option<u64>,
    key_rotated_at: Option<u64>,
    kek: Option<MasterKey>,
    mfa: Option<StoredMfaConfig>,
    pending_mfa_secret: Option<Zeroizing<Vec<u8>>>,
    pending_unlock: Option<PendingUnlock>,
}

enum UnlockAuditAction {
    Opened,
    Unlocked { lock_id: String },
}

struct UnlockStagingMeta {
    key_created_at: u64,
    key_rotated_at: Option<u64>,
    format_version: u16,
    audit: UnlockAuditAction,
    release_lock_on_cancel: bool,
}

struct PendingUnlock {
    payload_key: MasterKey,
    kek: MasterKey,
    entries: Vec<SecretEntry>,
    mfa: Option<StoredMfaConfig>,
    key_created_at: u64,
    key_rotated_at: Option<u64>,
    format_version: u16,
    audit: UnlockAuditAction,
    release_lock_on_cancel: bool,
}

impl PendingUnlock {
    fn zeroize_secrets(&mut self) {
        for entry in &mut self.entries {
            entry.zeroize_secrets();
        }
    }
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
            pending_unlock: None,
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

    fn audit(&self, action: AuditAction, entry_id: Option<&str>) -> Result<(), VaultError> {
        self.audit_logger.log(action, entry_id)
    }

    /// Records a compliance audit event (metadata-only — no secret payloads).
    pub fn record_audit(
        &self,
        action: AuditAction,
        entry_id: Option<&str>,
    ) -> Result<(), VaultError> {
        self.audit(action, entry_id)
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
        self.audit(AuditAction::VaultCreated, None)?;
        Ok(())
    }

    pub fn open(
        &mut self,
        path: impl AsRef<Path>,
        password: &str,
    ) -> Result<UnlockStep, VaultError> {
        let path = normalize_vault_path(path)?;
        self.cancel_pending_unlock()?;
        self.acquire_vault_lock(&path)?;

        let open_result = (|| -> Result<UnlockStep, VaultError> {
            let (meta, kek, payload_key, payload) = Self::load_decrypted_vault(&path, password)?;
            let key_created_at = effective_key_created_at(&meta, &path);
            let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);
            let format_version = meta.format_version;

            self.path = Some(path.clone());
            self.name = meta.name;
            self.kdf = meta.kdf;
            self.salt = Some(meta.salt);
            self.bind_audit_logger(&path)?;

            if Self::mfa_enabled_in_payload(&payload) {
                let pending = Self::build_pending_unlock(
                    kek,
                    payload_key,
                    payload,
                    UnlockStagingMeta {
                        key_created_at,
                        key_rotated_at,
                        format_version,
                        audit: UnlockAuditAction::Opened,
                        release_lock_on_cancel: true,
                    },
                );
                self.cached_entry_count = pending.entries.len();
                return Ok(self.stage_mfa_pending_unlock(pending));
            }

            self.master_key = Some(payload_key);
            self.kek = Some(kek);
            self.format_version = format_version;
            self.key_created_at = Some(key_created_at);
            self.key_rotated_at = key_rotated_at;
            self.apply_payload(payload);
            self.locked = false;
            self.audit(AuditAction::VaultOpened, None)?;
            Ok(UnlockStep::Complete)
        })();

        if open_result.is_err() {
            let _ = self.release_vault_lock();
        }

        open_result
    }

    pub fn unlock(&mut self, password: &str) -> Result<UnlockStep, VaultError> {
        if !self.locked {
            return Ok(UnlockStep::Complete);
        }

        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;

        self.cancel_pending_unlock()?;

        if self.vault_lock.is_none() {
            self.acquire_vault_lock(&path)?;
        }

        let lock_meta = self.assert_lock_valid()?;

        let (meta, kek, payload_key, payload) = Self::load_decrypted_vault(&path, password)?;
        let key_created_at = effective_key_created_at(&meta, &path);
        let key_rotated_at = (meta.key_rotated_at > 0).then_some(meta.key_rotated_at);
        let format_version = meta.format_version;

        if Self::mfa_enabled_in_payload(&payload) {
            let pending = Self::build_pending_unlock(
                kek,
                payload_key,
                payload,
                UnlockStagingMeta {
                    key_created_at,
                    key_rotated_at,
                    format_version,
                    audit: UnlockAuditAction::Unlocked {
                        lock_id: lock_meta.lock_id(),
                    },
                    release_lock_on_cancel: false,
                },
            );
            self.cached_entry_count = pending.entries.len();
            return Ok(self.stage_mfa_pending_unlock(pending));
        }

        self.master_key = Some(payload_key);
        self.kek = Some(kek);
        self.key_created_at = Some(key_created_at);
        self.key_rotated_at = key_rotated_at;
        self.format_version = format_version;
        self.apply_payload(payload);
        self.locked = false;
        if let Some(path) = self.path.clone() {
            self.bind_audit_logger(&path)?;
        }
        self.audit(AuditAction::VaultUnlocked, Some(&lock_meta.lock_id()))?;
        Ok(UnlockStep::Complete)
    }

    /// Completes unlock after a successful TOTP check when MFA is enabled.
    pub fn complete_unlock_with_mfa(&mut self, code: &str) -> Result<(), VaultError> {
        if !self.locked {
            return Ok(());
        }

        let pending = self
            .pending_unlock
            .take()
            .ok_or(VaultError::Other("no pending MFA unlock".into()))?;

        let stored = pending
            .mfa
            .as_ref()
            .filter(|config| config.enabled)
            .ok_or(VaultError::Other("MFA configuration missing".into()))?;

        let secret = mfa::decrypt_mfa_secret(&pending.payload_key, stored)?;
        let valid = mfa::verify_totp_code(secret.as_ref(), &self.name, code)?;
        if !valid {
            self.pending_unlock = Some(pending);
            return Err(VaultError::InvalidMfaCode);
        }

        self.commit_unlock(pending)
    }

    /// Discards a pending MFA unlock and clears any staged secrets.
    pub fn cancel_pending_unlock(&mut self) -> Result<(), VaultError> {
        let Some(mut pending) = self.pending_unlock.take() else {
            return Ok(());
        };

        pending.zeroize_secrets();

        if pending.release_lock_on_cancel {
            let _ = self.release_vault_lock();
            self.path = None;
            self.name = String::new();
            self.salt = None;
            self.kdf = KdfParams::default();
            self.format_version = format::FORMAT_VERSION_V2;
            self.key_created_at = None;
            self.key_rotated_at = None;
            self.cached_entry_count = 0;
            self.audit_logger = AuditLogger::disabled();
            self.vault_lock = None;
        }

        Ok(())
    }

    /// Locks the vault and purges decrypted secrets and the master key from RAM.
    pub fn lock(&mut self) {
        if !self.locked {
            let _ = self.audit(AuditAction::VaultLocked, None);
        }
        let _ = self.cancel_pending_unlock();
        self.cached_entry_count = self.entries.len();
        for entry in &mut self.entries {
            entry.zeroize_secrets();
        }
        self.master_key = None;
        self.kek = None;
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
        self.salt = Some(meta.salt);
        self.format_version = meta.format_version;
        self.key_created_at = Some(key_created_at);
        self.key_rotated_at = key_rotated_at;
        self.master_key = None;
        self.entries.clear();
        self.mfa = None;
        self.pending_mfa_secret = None;
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
        self.audit(AuditAction::EntryCreated, Some(&summary.id))?;
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
        self.audit(AuditAction::EntryUpdated, Some(id))?;
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
        self.audit(AuditAction::SecretRevealed, Some(id))?;
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
        self.audit(AuditAction::VaultKeyRotated, None)?;
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
        crate::compliance::compliance_status(path)
    }

    /// Re-reads the vault file from disk after an external change (e.g. Git pull).
    pub fn reload_from_disk(&mut self) -> Result<(), VaultError> {
        let path = self.path.clone().ok_or(VaultError::NoVaultFile)?;
        if self.locked {
            return self.attach_locked(path);
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
        }

        Ok(true)
    }

    /// Returns whether TOTP MFA is active for the current vault session.
    pub fn mfa_status(&self) -> MfaStatus {
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
        Ok(())
    }

    fn apply_payload(&mut self, payload: format::VaultPayload) {
        self.entries = payload.entries;
        self.mfa = payload.mfa;
        self.cached_entry_count = self.entries.len();
    }

    fn load_decrypted_vault(
        path: &Path,
        password: &str,
    ) -> Result<
        (
            format::VaultFileMeta,
            MasterKey,
            MasterKey,
            format::VaultPayload,
        ),
        VaultError,
    > {
        let meta = format::read_vault_meta(path)?;
        let kek = MasterKey::derive_from_password(password, &meta.salt, meta.kdf)?;
        let payload_key = format::resolve_payload_key(&meta, &kek)?;
        let (_, payload) = format::read_vault_file(path, &kek)?;
        Ok((meta, kek, payload_key, payload))
    }

    fn mfa_enabled_in_payload(payload: &format::VaultPayload) -> bool {
        payload.mfa.as_ref().is_some_and(|config| config.enabled)
    }

    fn build_pending_unlock(
        kek: MasterKey,
        payload_key: MasterKey,
        payload: format::VaultPayload,
        staging: UnlockStagingMeta,
    ) -> PendingUnlock {
        PendingUnlock {
            payload_key,
            kek,
            entries: payload.entries,
            mfa: payload.mfa,
            key_created_at: staging.key_created_at,
            key_rotated_at: staging.key_rotated_at,
            format_version: staging.format_version,
            audit: staging.audit,
            release_lock_on_cancel: staging.release_lock_on_cancel,
        }
    }

    fn stage_mfa_pending_unlock(&mut self, pending: PendingUnlock) -> UnlockStep {
        self.pending_unlock = Some(pending);
        UnlockStep::MfaRequired
    }

    fn commit_unlock(&mut self, pending: PendingUnlock) -> Result<(), VaultError> {
        self.master_key = Some(pending.payload_key);
        self.kek = Some(pending.kek);
        self.key_created_at = Some(pending.key_created_at);
        self.key_rotated_at = pending.key_rotated_at;
        self.format_version = pending.format_version;
        self.apply_payload(format::VaultPayload {
            entries: pending.entries,
            mfa: pending.mfa,
        });
        self.locked = false;
        if let Some(path) = self.path.clone() {
            self.bind_audit_logger(&path)?;
        }
        match &pending.audit {
            UnlockAuditAction::Opened => self.audit(AuditAction::VaultOpened, None)?,
            UnlockAuditAction::Unlocked { lock_id } => {
                self.audit(AuditAction::VaultUnlocked, Some(lock_id))?
            }
        }
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
        let payload_key = self.master_key.as_ref().ok_or(VaultError::Locked)?;
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

    fn finish_unlock(vault: &mut Vault, step: UnlockStep, mfa_code: Option<&str>) {
        match step {
            UnlockStep::Complete => {}
            UnlockStep::MfaRequired => {
                vault
                    .complete_unlock_with_mfa(mfa_code.expect("MFA code required"))
                    .expect("complete MFA unlock");
            }
        }
    }

    fn open_vault(vault: &mut Vault, path: &Path, password: &str, mfa_code: Option<&str>) {
        let step = vault.open(path, password).expect("open vault");
        finish_unlock(vault, step, mfa_code);
    }

    fn unlock_vault(vault: &mut Vault, password: &str, mfa_code: Option<&str>) {
        let step = vault.unlock(password).expect("unlock vault");
        finish_unlock(vault, step, mfa_code);
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
            .open(&path, "correct-horse-battery-staple")
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
            .unlock("correct-horse-battery-staple")
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
            .open(&path, "correct-horse-battery-staple")
            .expect("reopen");
        assert_eq!(step, UnlockStep::MfaRequired);
        assert!(reopened.info().locked);
        reopened
            .complete_unlock_with_mfa(&token)
            .expect("complete MFA unlock");
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

        let step = session.unlock(password).expect("password accepted");
        assert_eq!(step, UnlockStep::MfaRequired);
        assert!(session.info().locked);
        assert!(session.list_entries().is_err());

        let err = session
            .complete_unlock_with_mfa("000000")
            .expect_err("wrong code");
        assert!(matches!(err, VaultError::InvalidMfaCode));
        assert!(session.info().locked);

        session
            .complete_unlock_with_mfa(&token)
            .expect("valid MFA code");
        assert!(!session.info().locked);
        assert_eq!(session.list_entries().unwrap().len(), 0);
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
}
