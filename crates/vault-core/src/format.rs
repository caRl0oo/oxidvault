// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! `.oxid` on-disk format — v1/v2 (single-user), v3 (legacy multi-user), v4 (AAD-bound header).
#![allow(clippy::too_many_arguments)]

use std::fs;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, MasterKey, NONCE_LEN, SALT_LEN};
use crate::entry::SecretEntry;
use crate::error::VaultError;
use crate::mfa::StoredMfaConfig;
use crate::vault_user::VaultUser;

pub const MAGIC: &[u8; 4] = b"OXID";
pub const FORMAT_VERSION_V1: u16 = 1;
pub const FORMAT_VERSION_V2: u16 = 2;
pub const FORMAT_VERSION_V3: u16 = 3;
pub const FORMAT_VERSION_V4: u16 = 4;

/// Multi-user vault formats (shared DEK, `users_json` header block).
pub fn is_multi_user_format(format_version: u16) -> bool {
    format_version == FORMAT_VERSION_V3 || format_version == FORMAT_VERSION_V4
}

#[derive(Debug, Clone)]
pub struct WrappedDek {
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct VaultFileMeta {
    pub name: String,
    pub kdf: KdfParams,
    pub salt: [u8; SALT_LEN],
    pub format_version: u16,
    pub key_created_at: u64,
    pub key_rotated_at: u64,
    pub wrapped_dek: Option<WrappedDek>,
    /// Multi-user entries (format v3 only).
    pub users: Option<Vec<VaultUser>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub entries: Vec<SecretEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mfa: Option<StoredMfaConfig>,
    /// Present in v4+ encrypted payloads — downgrade guard vs. on-disk header version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_version: Option<u16>,
}

#[derive(Serialize)]
struct VaultPayloadRef<'a> {
    entries: &'a [SecretEntry],
    #[serde(skip_serializing_if = "Option::is_none")]
    mfa: Option<&'a StoredMfaConfig>,
}

/// Entries and optional MFA config for atomic vault writes.
pub struct VaultPersistPayload<'a> {
    pub entries: &'a [SecretEntry],
    pub mfa: Option<&'a StoredMfaConfig>,
}

impl<'a> VaultPersistPayload<'a> {
    pub fn entries_only(entries: &'a [SecretEntry]) -> Self {
        Self { entries, mfa: None }
    }
}

struct VaultWriteContext<'a> {
    name: &'a str,
    kdf: KdfParams,
    salt: &'a [u8; SALT_LEN],
    payload_key: &'a MasterKey,
    kek: Option<&'a MasterKey>,
    key_created_at: u64,
    key_rotated_at: u64,
    format_version: u16,
}

fn serialize_payload_zeroizing(
    entries: &[SecretEntry],
    mfa: Option<&StoredMfaConfig>,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    Ok(Zeroizing::new(
        serde_json::to_vec(&VaultPayloadRef { entries, mfa })
            .map_err(|e| VaultError::Other(e.to_string()))?,
    ))
}

#[derive(Serialize)]
struct VaultPayloadV4Ref<'a> {
    entries: &'a [SecretEntry],
    #[serde(skip_serializing_if = "Option::is_none")]
    mfa: Option<&'a StoredMfaConfig>,
    format_version: u16,
}

fn serialize_payload_v4_zeroizing(
    entries: &[SecretEntry],
    mfa: Option<&StoredMfaConfig>,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    Ok(Zeroizing::new(
        serde_json::to_vec(&VaultPayloadV4Ref {
            entries,
            mfa,
            format_version: FORMAT_VERSION_V4,
        })
        .map_err(|e| VaultError::Other(e.to_string()))?,
    ))
}

/// Serialized header bytes (magic through end of `users_json`) used as AES-GCM AAD in v4.
pub(crate) fn serialize_header_v4(
    format_version: u16,
    name: &str,
    users: &[VaultUser],
    key_created_at: u64,
    key_rotated_at: u64,
) -> Result<Vec<u8>, VaultError> {
    if !is_multi_user_format(format_version) {
        return Err(VaultError::InvalidFormat);
    }

    let name_bytes = name.as_bytes();
    if name_bytes.len() > u16::MAX as usize {
        return Err(VaultError::Other("vault name too long".into()));
    }

    let users_json = serde_json::to_vec(users).map_err(|e| VaultError::Other(e.to_string()))?;

    let mut header = Vec::new();
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&format_version.to_le_bytes());
    header.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    header.extend_from_slice(name_bytes);
    header.extend_from_slice(&key_created_at.to_le_bytes());
    header.extend_from_slice(&key_rotated_at.to_le_bytes());
    header.extend_from_slice(&(users_json.len() as u32).to_le_bytes());
    header.extend_from_slice(&users_json);
    Ok(header)
}

fn verify_payload_format_version(
    header_version: u16,
    payload: &VaultPayload,
) -> Result<(), VaultError> {
    match payload.format_version {
        None if header_version >= FORMAT_VERSION_V4 => Err(VaultError::InvalidFormat),
        None => Ok(()),
        Some(payload_version) if payload_version > header_version => {
            Err(VaultError::FormatDowngrade)
        }
        Some(payload_version)
            if header_version >= FORMAT_VERSION_V4 && payload_version != header_version =>
        {
            Err(VaultError::InvalidFormat)
        }
        Some(_) => Ok(()),
    }
}

pub fn write_vault_file(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    kek: &MasterKey,
    dek: &MasterKey,
    key_created_at: u64,
    key_rotated_at: u64,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    write_vault_file_payload(
        path,
        name,
        kdf,
        salt,
        kek,
        dek,
        key_created_at,
        key_rotated_at,
        VaultPersistPayload::entries_only(entries),
    )
}

pub fn write_vault_file_payload(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    kek: &MasterKey,
    dek: &MasterKey,
    key_created_at: u64,
    key_rotated_at: u64,
    payload: VaultPersistPayload<'_>,
) -> Result<(), VaultError> {
    if path.exists() {
        return Err(VaultError::FileExists);
    }
    atomic_write_vault_with_context(
        path,
        VaultWriteContext {
            name,
            kdf,
            salt,
            payload_key: dek,
            kek: Some(kek),
            key_created_at,
            key_rotated_at,
            format_version: FORMAT_VERSION_V2,
        },
        payload.entries,
        payload.mfa,
    )
}

/// Legacy v1 write — master key encrypts payload directly (tests / migration reference).
pub fn write_vault_file_v1(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    key: &MasterKey,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    write_vault_file_v1_payload(
        path,
        name,
        kdf,
        salt,
        key,
        VaultPersistPayload::entries_only(entries),
    )
}

pub fn write_vault_file_v1_payload(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    key: &MasterKey,
    payload: VaultPersistPayload<'_>,
) -> Result<(), VaultError> {
    if path.exists() {
        return Err(VaultError::FileExists);
    }
    atomic_write_vault_with_context(
        path,
        VaultWriteContext {
            name,
            kdf,
            salt,
            payload_key: key,
            kek: None,
            key_created_at: 0,
            key_rotated_at: 0,
            format_version: FORMAT_VERSION_V1,
        },
        payload.entries,
        payload.mfa,
    )
}

pub fn update_vault_file(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    payload_key: &MasterKey,
    kek: Option<&MasterKey>,
    format_version: u16,
    key_created_at: u64,
    key_rotated_at: u64,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    update_vault_file_payload(
        path,
        name,
        kdf,
        salt,
        payload_key,
        kek,
        format_version,
        key_created_at,
        key_rotated_at,
        VaultPersistPayload::entries_only(entries),
    )
}

pub fn update_vault_file_payload(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    payload_key: &MasterKey,
    kek: Option<&MasterKey>,
    format_version: u16,
    key_created_at: u64,
    key_rotated_at: u64,
    payload: VaultPersistPayload<'_>,
) -> Result<(), VaultError> {
    atomic_write_vault_with_context(
        path,
        VaultWriteContext {
            name,
            kdf,
            salt,
            payload_key,
            kek,
            key_created_at,
            key_rotated_at,
            format_version,
        },
        payload.entries,
        payload.mfa,
    )
}

/// Re-encrypts only the master-key container (header) and leaves the payload blob unchanged.
pub fn rotate_vault_key_container(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    new_salt: &[u8; SALT_LEN],
    new_kek: &MasterKey,
    dek: &MasterKey,
    key_created_at: u64,
    key_rotated_at: u64,
) -> Result<(), VaultError> {
    let (_, payload_blob) = read_raw_vault(path)?;
    let (dek_nonce, dek_ciphertext) = crypto::wrap_data_key(new_kek, dek)?;

    let tmp_path = temp_vault_path(path)?;
    if let Err(error) = write_vault_with_payload_blob(
        &tmp_path,
        name,
        kdf,
        new_salt,
        FORMAT_VERSION_V2,
        key_created_at,
        key_rotated_at,
        &dek_nonce,
        &dek_ciphertext,
        &payload_blob,
    ) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    if fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }

    match copy_temp_over_target(&tmp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&tmp_path);
            Ok(())
        }
        Err(copy_err) => {
            let _ = fs::remove_file(&tmp_path);
            Err(copy_err)
        }
    }
}

fn atomic_write_vault_with_context(
    path: &Path,
    context: VaultWriteContext<'_>,
    entries: &[SecretEntry],
    mfa: Option<&StoredMfaConfig>,
) -> Result<(), VaultError> {
    let tmp_path = temp_vault_path(path)?;

    if let Err(error) = write_vault_bytes_with_context(&tmp_path, context, entries, mfa) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    if fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }

    match copy_temp_over_target(&tmp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&tmp_path);
            Ok(())
        }
        Err(copy_err) => {
            let _ = fs::remove_file(&tmp_path);
            Err(copy_err)
        }
    }
}

/// Returns `{dir}/{name}.oxid.tmp` — temp file must live beside the vault on the same share.
pub(crate) fn temp_vault_path(path: &Path) -> Result<PathBuf, VaultError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| VaultError::Other("vault path has no parent directory".into()))?;

    let file_name = path
        .file_name()
        .ok_or_else(|| VaultError::Other("vault path has no file name".into()))?;

    let mut tmp_name = file_name.to_os_string();
    tmp_name.push(".tmp");
    Ok(parent.join(tmp_name))
}

fn copy_temp_over_target(temp_path: &Path, target_path: &Path) -> Result<(), VaultError> {
    let mut temp_file = fs::File::open(temp_path)?;
    let mut target_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(target_path)?;

    io::copy(&mut temp_file, &mut target_file)?;
    target_file.sync_all()?;
    Ok(())
}

fn write_vault_bytes_with_context(
    path: &Path,
    context: VaultWriteContext<'_>,
    entries: &[SecretEntry],
    mfa: Option<&StoredMfaConfig>,
) -> Result<(), VaultError> {
    let plaintext = serialize_payload_zeroizing(entries, mfa)?;
    let (nonce, ciphertext) = crypto::encrypt(context.payload_key, plaintext.as_ref())?;
    let mut payload_blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload_blob.extend_from_slice(&nonce);
    payload_blob.extend_from_slice(&ciphertext);

    match context.format_version {
        FORMAT_VERSION_V1 => {
            let empty_nonce = [0u8; NONCE_LEN];
            write_vault_with_payload_blob(
                path,
                context.name,
                context.kdf,
                context.salt,
                FORMAT_VERSION_V1,
                0,
                0,
                &empty_nonce,
                &[],
                &payload_blob,
            )
        }
        FORMAT_VERSION_V2 => {
            let kek = context
                .kek
                .ok_or_else(|| VaultError::Other("missing KEK for v2 vault write".into()))?;
            let (dek_nonce, dek_ciphertext) = crypto::wrap_data_key(kek, context.payload_key)?;
            write_vault_with_payload_blob(
                path,
                context.name,
                context.kdf,
                context.salt,
                FORMAT_VERSION_V2,
                context.key_created_at,
                context.key_rotated_at,
                &dek_nonce,
                &dek_ciphertext,
                &payload_blob,
            )
        }
        _ => Err(VaultError::InvalidFormat),
    }
}

fn write_vault_with_payload_blob(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    format_version: u16,
    key_created_at: u64,
    key_rotated_at: u64,
    dek_nonce: &[u8; NONCE_LEN],
    dek_ciphertext: &[u8],
    payload_blob: &[u8],
) -> Result<(), VaultError> {
    let mut file = fs::File::create(path)?;
    write_header(
        &mut file,
        name,
        kdf,
        salt,
        format_version,
        key_created_at,
        key_rotated_at,
        dek_nonce,
        dek_ciphertext,
    )?;
    file.write_all(payload_blob)?;
    file.sync_all()?;
    Ok(())
}

pub fn read_raw_vault(path: &Path) -> Result<(VaultFileMeta, Vec<u8>), VaultError> {
    let bytes = fs::read(path)?;
    let (meta, header_len) = parse_header(&bytes)?;
    Ok((meta, bytes[header_len..].to_vec()))
}

pub fn read_vault_file(
    path: &Path,
    kek: &MasterKey,
) -> Result<(VaultFileMeta, VaultPayload), VaultError> {
    let (meta, payload_blob) = read_raw_vault(path)?;
    let payload_key = resolve_payload_key(&meta, kek)?;
    decrypt_payload_blob_with_meta(meta, &payload_key, &payload_blob)
}

pub fn read_vault_meta(path: &Path) -> Result<VaultFileMeta, VaultError> {
    let bytes = fs::read(path)?;
    parse_header(&bytes).map(|(meta, _)| meta)
}

fn decrypt_payload_blob_with_meta(
    meta: VaultFileMeta,
    payload_key: &MasterKey,
    payload_blob: &[u8],
) -> Result<(VaultFileMeta, VaultPayload), VaultError> {
    if payload_blob.len() <= NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let (nonce_bytes, ciphertext) = payload_blob.split_at(NONCE_LEN);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(nonce_bytes);

    if ciphertext.is_empty() {
        return Err(VaultError::InvalidFormat);
    }

    let plaintext = crypto::decrypt(payload_key, &nonce, ciphertext)?;
    let payload: VaultPayload =
        serde_json::from_slice(plaintext.as_ref()).map_err(|_| VaultError::InvalidFormat)?;

    Ok((meta, payload))
}

pub fn resolve_payload_key(meta: &VaultFileMeta, kek: &MasterKey) -> Result<MasterKey, VaultError> {
    match meta.format_version {
        FORMAT_VERSION_V1 => Ok(MasterKey::from_bytes(*kek.as_bytes())),
        FORMAT_VERSION_V2 => {
            let wrapped = meta.wrapped_dek.as_ref().ok_or(VaultError::InvalidFormat)?;
            crypto::unwrap_data_key(kek, &wrapped.nonce, &wrapped.ciphertext)
        }
        FORMAT_VERSION_V3 | FORMAT_VERSION_V4 => Err(VaultError::InvalidFormat),
        _ => Err(VaultError::InvalidFormat),
    }
}

/// Parsed v3/v4 vault file on disk: plaintext user table in the header plus the
/// still-encrypted payload block (nonce + ciphertext) that follows the header bytes.
#[derive(Debug, Clone)]
pub struct MultiUserVaultFile {
    /// User records from the vault header (KDF params, wrapped DEK, MFA blobs, …).
    pub users: Vec<VaultUser>,
    /// Serialized header bytes used as AES-GCM AAD when decrypting the payload (v4+).
    pub header_aad: Vec<u8>,
    /// On-disk format version (`FORMAT_VERSION_V3` or `FORMAT_VERSION_V4`).
    pub format_version: u16,
    /// AES-GCM nonce prepended to the encrypted payload blob.
    pub payload_nonce: [u8; NONCE_LEN],
    /// AES-GCM ciphertext of the serialized [`VaultPayload`].
    pub payload_ciphertext: Vec<u8>,
}

/// Reads a multi-user vault header and encrypted payload parts (v3 or v4).
pub fn read_multi_user_vault_file(path: &Path) -> Result<MultiUserVaultFile, VaultError> {
    let bytes = fs::read(path)?;
    let (meta, header_len) = parse_header(&bytes)?;
    if !is_multi_user_format(meta.format_version) {
        return Err(VaultError::InvalidFormat);
    }
    let users = meta.users.ok_or(VaultError::InvalidFormat)?;
    let payload_blob = &bytes[header_len..];
    if payload_blob.len() <= NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let (nonce_bytes, ciphertext) = payload_blob.split_at(NONCE_LEN);
    let mut payload_nonce = [0u8; NONCE_LEN];
    payload_nonce.copy_from_slice(nonce_bytes);
    Ok(MultiUserVaultFile {
        users,
        header_aad: bytes[..header_len].to_vec(),
        format_version: meta.format_version,
        payload_nonce,
        payload_ciphertext: ciphertext.to_vec(),
    })
}

/// Writes a new v3 vault file (fails if the path already exists).
pub fn write_v3_vault_file(
    path: &Path,
    name: &str,
    users: &[VaultUser],
    dek: &[u8; 32],
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    if path.exists() {
        return Err(VaultError::FileExists);
    }
    let dek_key = MasterKey::from_bytes(*dek);
    let key_created_at = crate::compliance::unix_timestamp_secs();
    atomic_write_v3_vault(path, name, users, &dek_key, entries, key_created_at, 0)
}

/// Atomically rewrites an existing v3 vault file.
pub fn update_v3_vault_file(
    path: &Path,
    name: &str,
    users: &[VaultUser],
    dek: &MasterKey,
    entries: &[SecretEntry],
    key_created_at: u64,
    key_rotated_at: u64,
) -> Result<(), VaultError> {
    atomic_write_v3_vault(
        path,
        name,
        users,
        dek,
        entries,
        key_created_at,
        key_rotated_at,
    )
}

fn atomic_write_v3_vault(
    path: &Path,
    name: &str,
    users: &[VaultUser],
    dek: &MasterKey,
    entries: &[SecretEntry],
    key_created_at: u64,
    key_rotated_at: u64,
) -> Result<(), VaultError> {
    let tmp_path = temp_vault_path(path)?;
    if let Err(error) = write_multi_user_vault_bytes(
        &tmp_path,
        name,
        users,
        dek,
        entries,
        key_created_at,
        key_rotated_at,
    ) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    if fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }

    match copy_temp_over_target(&tmp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&tmp_path);
            Ok(())
        }
        Err(copy_err) => {
            let _ = fs::remove_file(&tmp_path);
            Err(copy_err)
        }
    }
}

fn write_multi_user_vault_bytes(
    path: &Path,
    name: &str,
    users: &[VaultUser],
    dek: &MasterKey,
    entries: &[SecretEntry],
    key_created_at: u64,
    key_rotated_at: u64,
) -> Result<(), VaultError> {
    let header_bytes = serialize_header_v4(
        FORMAT_VERSION_V4,
        name,
        users,
        key_created_at,
        key_rotated_at,
    )?;
    let plaintext = serialize_payload_v4_zeroizing(entries, None)?;
    let (nonce, ciphertext) = crypto::encrypt_with_aad(dek, plaintext.as_ref(), &header_bytes)?;
    let mut file = fs::File::create(path)?;
    file.write_all(&header_bytes)?;
    file.write_all(&nonce)?;
    file.write_all(&ciphertext)?;
    file.sync_all()?;
    Ok(())
}

/// Decrypts a multi-user vault payload (v3 without AAD, v4 with header AAD).
pub fn decrypt_multi_user_payload(
    dek: &MasterKey,
    payload_nonce: &[u8],
    payload_ciphertext: &[u8],
    header_format_version: u16,
    header_aad: &[u8],
) -> Result<VaultPayload, VaultError> {
    if payload_nonce.len() != NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(payload_nonce);
    if payload_ciphertext.is_empty() {
        return Err(VaultError::InvalidFormat);
    }

    let plaintext = if header_format_version >= FORMAT_VERSION_V4 {
        crypto::decrypt_with_aad(dek, &nonce, payload_ciphertext, header_aad)?
    } else {
        crypto::decrypt(dek, &nonce, payload_ciphertext)?
    };
    let payload: VaultPayload =
        serde_json::from_slice(plaintext.as_ref()).map_err(|_| VaultError::InvalidFormat)?;
    verify_payload_format_version(header_format_version, &payload)?;
    Ok(payload)
}

/// Decrypts a v3/v4 payload blob using the shared DEK.
pub fn decrypt_v3_payload(
    dek: &MasterKey,
    payload_nonce: &[u8],
    payload_ciphertext: &[u8],
) -> Result<VaultPayload, VaultError> {
    decrypt_multi_user_payload(
        dek,
        payload_nonce,
        payload_ciphertext,
        FORMAT_VERSION_V3,
        &[],
    )
}

fn write_header(
    writer: &mut impl Write,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    format_version: u16,
    key_created_at: u64,
    key_rotated_at: u64,
    dek_nonce: &[u8; NONCE_LEN],
    dek_ciphertext: &[u8],
) -> Result<(), VaultError> {
    let name_bytes = name.as_bytes();
    if name_bytes.len() > u16::MAX as usize {
        return Err(VaultError::Other("vault name too long".into()));
    }

    writer.write_all(MAGIC)?;
    writer.write_all(&format_version.to_le_bytes())?;
    writer.write_all(&kdf.memory_kib.to_le_bytes())?;
    writer.write_all(&kdf.iterations.to_le_bytes())?;
    writer.write_all(&kdf.parallelism.to_le_bytes())?;
    writer.write_all(salt)?;
    writer.write_all(&(name_bytes.len() as u16).to_le_bytes())?;
    writer.write_all(name_bytes)?;

    if format_version == FORMAT_VERSION_V2 {
        writer.write_all(&key_created_at.to_le_bytes())?;
        writer.write_all(&key_rotated_at.to_le_bytes())?;
        writer.write_all(dek_nonce)?;
        writer.write_all(&(dek_ciphertext.len() as u32).to_le_bytes())?;
        writer.write_all(dek_ciphertext)?;
    }

    Ok(())
}

fn parse_header(bytes: &[u8]) -> Result<(VaultFileMeta, usize), VaultError> {
    let mut cursor = Cursor::new(bytes);
    let meta = read_header(&mut cursor)?;
    Ok((meta, cursor.position() as usize))
}

fn read_header(reader: &mut impl Read) -> Result<VaultFileMeta, VaultError> {
    let mut magic = [0u8; 4];
    reader.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Err(VaultError::InvalidFormat);
    }

    let mut version = [0u8; 2];
    reader.read_exact(&mut version)?;
    let format_version = u16::from_le_bytes(version);
    if is_multi_user_format(format_version) {
        return read_header_v3_v4(reader, format_version);
    }
    if format_version != FORMAT_VERSION_V1 && format_version != FORMAT_VERSION_V2 {
        return Err(VaultError::InvalidFormat);
    }

    read_header_v1_v2(reader, format_version)
}

fn read_header_v3_v4(
    reader: &mut impl Read,
    format_version: u16,
) -> Result<VaultFileMeta, VaultError> {
    let mut name_len = [0u8; 2];
    reader.read_exact(&mut name_len)?;
    let len = u16::from_le_bytes(name_len) as usize;
    let mut name_buf = vec![0u8; len];
    reader.read_exact(&mut name_buf)?;
    let name = String::from_utf8(name_buf).map_err(|_| VaultError::InvalidFormat)?;

    let mut created = [0u8; 8];
    let mut rotated = [0u8; 8];
    reader.read_exact(&mut created)?;
    reader.read_exact(&mut rotated)?;

    let mut users_len = [0u8; 4];
    reader.read_exact(&mut users_len)?;
    let users_size = u32::from_le_bytes(users_len) as usize;
    let mut users_buf = vec![0u8; users_size];
    reader.read_exact(&mut users_buf)?;
    let users: Vec<VaultUser> =
        serde_json::from_slice(&users_buf).map_err(|_| VaultError::InvalidFormat)?;

    Ok(VaultFileMeta {
        name,
        kdf: KdfParams::default(),
        salt: [0u8; SALT_LEN],
        format_version,
        key_created_at: u64::from_le_bytes(created),
        key_rotated_at: u64::from_le_bytes(rotated),
        wrapped_dek: None,
        users: Some(users),
    })
}

fn read_header_v1_v2(
    reader: &mut impl Read,
    format_version: u16,
) -> Result<VaultFileMeta, VaultError> {
    let mut memory = [0u8; 4];
    let mut iterations = [0u8; 4];
    let mut parallelism = [0u8; 4];
    reader.read_exact(&mut memory)?;
    reader.read_exact(&mut iterations)?;
    reader.read_exact(&mut parallelism)?;

    let mut salt = [0u8; SALT_LEN];
    reader.read_exact(&mut salt)?;

    let mut name_len = [0u8; 2];
    reader.read_exact(&mut name_len)?;
    let len = u16::from_le_bytes(name_len) as usize;
    let mut name_buf = vec![0u8; len];
    reader.read_exact(&mut name_buf)?;
    let name = String::from_utf8(name_buf).map_err(|_| VaultError::InvalidFormat)?;

    let (key_created_at, key_rotated_at, wrapped_dek) = if format_version == FORMAT_VERSION_V2 {
        let mut created = [0u8; 8];
        let mut rotated = [0u8; 8];
        reader.read_exact(&mut created)?;
        reader.read_exact(&mut rotated)?;

        let mut dek_nonce = [0u8; NONCE_LEN];
        reader.read_exact(&mut dek_nonce)?;

        let mut dek_len = [0u8; 4];
        reader.read_exact(&mut dek_len)?;
        let dek_size = u32::from_le_bytes(dek_len) as usize;
        let mut dek_ciphertext = vec![0u8; dek_size];
        reader.read_exact(&mut dek_ciphertext)?;

        (
            u64::from_le_bytes(created),
            u64::from_le_bytes(rotated),
            Some(WrappedDek {
                nonce: dek_nonce,
                ciphertext: dek_ciphertext,
            }),
        )
    } else {
        (0, 0, None)
    };

    Ok(VaultFileMeta {
        name,
        kdf: KdfParams {
            memory_kib: u32::from_le_bytes(memory),
            iterations: u32::from_le_bytes(iterations),
            parallelism: u32::from_le_bytes(parallelism),
        },
        salt,
        format_version,
        key_created_at,
        key_rotated_at,
        wrapped_dek,
        users: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{random_salt, MasterKey};
    use crate::entry::{SecretEntry, SecretEntryInput, SecretPayload};
    use std::io::Write;
    use tempfile::tempdir;

    fn sample_payload() -> VaultPayload {
        let entry = SecretEntry::from_input(SecretEntryInput {
            title: "Test".into(),
            folder: Some("Billing".into()),
            tags: vec!["prod".into()],
            expires_at: None,
            payload: SecretPayload::ApiToken {
                service: "Stripe".into(),
                token: "sk_test_xxx".into(),
            },
        })
        .unwrap();
        VaultPayload {
            entries: vec![entry],
            mfa: None,
            format_version: None,
        }
    }

    #[test]
    fn vault_file_roundtrip() {
        let salt = random_salt();
        let kdf = KdfParams::default();
        let key = MasterKey::derive_from_password("pw", &salt, kdf).unwrap();
        let payload = sample_payload();

        let dir = tempdir().unwrap();
        let path = dir.path().join("test.oxid");
        write_vault_file_v1(&path, "MyVault", kdf, &salt, &key, &payload.entries).unwrap();

        let (meta, loaded) = read_vault_file(&path, &key).unwrap();
        assert_eq!(meta.name, "MyVault");
        assert_eq!(loaded.entries.len(), 1);
        match &loaded.entries[0].payload {
            SecretPayload::ApiToken { token, .. } => assert_eq!(token, "sk_test_xxx"),
            _ => panic!("wrong type"),
        }
    }

    #[test]
    fn atomic_update_leaves_temp_suffix() {
        let salt = random_salt();
        let kdf = KdfParams::default();
        let key = MasterKey::derive_from_password("pw", &salt, kdf).unwrap();
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");

        write_vault_file_v1(
            &path,
            "MyVault",
            kdf,
            &salt,
            &key,
            &sample_payload().entries,
        )
        .unwrap();
        assert!(path.exists());
        assert!(!temp_vault_path(&path).unwrap().exists());

        update_vault_file(
            &path,
            "MyVault",
            kdf,
            &salt,
            &key,
            None,
            FORMAT_VERSION_V1,
            0,
            0,
            &sample_payload().entries,
        )
        .unwrap();
        assert!(path.exists());
        assert!(!temp_vault_path(&path).unwrap().exists());
    }

    #[test]
    fn key_rotation_preserves_payload_blob() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.oxid");
        let salt = random_salt();
        let kdf = KdfParams::default();
        let kek = MasterKey::derive_from_password("old-password", &salt, kdf).unwrap();
        let dek = MasterKey::generate_data_key();
        let created = 1_700_000_000_u64;

        write_vault_file(
            &path,
            "RotateVault",
            kdf,
            &salt,
            &kek,
            &dek,
            created,
            0,
            &sample_payload().entries,
        )
        .unwrap();

        let (_, before_blob) = read_raw_vault(&path).unwrap();
        let new_salt = random_salt();
        let new_kek = MasterKey::derive_from_password("new-password", &new_salt, kdf).unwrap();
        rotate_vault_key_container(
            &path,
            "RotateVault",
            kdf,
            &new_salt,
            &new_kek,
            &dek,
            created,
            created + 86_400,
        )
        .unwrap();

        let (_, after_blob) = read_raw_vault(&path).unwrap();
        assert_eq!(before_blob, after_blob);

        let new_kek_open = MasterKey::derive_from_password("new-password", &new_salt, kdf).unwrap();
        let (_, loaded) = read_vault_file(&path, &new_kek_open).unwrap();
        assert_eq!(loaded.entries.len(), 1);
    }

    #[test]
    fn temp_vault_path_is_in_target_directory() {
        #[cfg(windows)]
        let path = PathBuf::from(r"\\fileserver\team\vault.oxid");
        #[cfg(not(windows))]
        let path = PathBuf::from("/mnt/share/vault.oxid");

        let tmp = temp_vault_path(&path).unwrap();
        assert_eq!(tmp.parent(), path.parent());
        assert!(tmp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".oxid.tmp"));
    }

    #[test]
    fn copy_temp_over_target_replaces_contents() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("vault.oxid");
        let temp = dir.path().join("vault.oxid.tmp");

        {
            let mut file = fs::File::create(&target).unwrap();
            file.write_all(b"old-content").unwrap();
        }
        {
            let mut file = fs::File::create(&temp).unwrap();
            file.write_all(b"new-content").unwrap();
            file.sync_all().unwrap();
        }

        copy_temp_over_target(&temp, &target).unwrap();

        let content = fs::read(&target).unwrap();
        assert_eq!(content, b"new-content");
    }

    fn write_legacy_v3_vault_bytes(
        path: &Path,
        name: &str,
        users: &[VaultUser],
        dek: &MasterKey,
        entries: &[SecretEntry],
        key_created_at: u64,
        key_rotated_at: u64,
    ) -> Result<(), VaultError> {
        let header_bytes = serialize_header_v4(
            FORMAT_VERSION_V3,
            name,
            users,
            key_created_at,
            key_rotated_at,
        )?;
        let plaintext = serialize_payload_zeroizing(entries, None)?;
        let (nonce, ciphertext) = crypto::encrypt(dek, plaintext.as_ref())?;
        let mut file = fs::File::create(path)?;
        file.write_all(&header_bytes)?;
        file.write_all(&nonce)?;
        file.write_all(&ciphertext)?;
        file.sync_all()?;
        Ok(())
    }

    fn open_multi_user_fixture(
        path: &Path,
        user: &crate::vault_user::VaultUser,
        password: &str,
    ) -> Result<VaultPayload, VaultError> {
        use crate::vault_user::unwrap_user_dek;

        let file = read_multi_user_vault_file(path)?;
        let kdf = KdfParams {
            memory_kib: user.kdf_memory_kib,
            iterations: user.kdf_iterations,
            parallelism: user.kdf_parallelism,
        };
        let salt = crate::vault_user::decode_salt(&user.kdf_salt)?;
        let kek = MasterKey::derive_from_password(password, &salt, kdf)?;
        let dek = unwrap_user_dek(user, &kek)?;
        decrypt_multi_user_payload(
            &dek,
            &file.payload_nonce,
            &file.payload_ciphertext,
            file.format_version,
            &file.header_aad,
        )
    }

    #[test]
    fn v4_vault_file_roundtrip() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("v4.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();
        let payload = sample_payload();

        write_v3_vault_file(
            &path,
            "V4Vault",
            std::slice::from_ref(&user),
            dek.as_bytes(),
            &payload.entries,
        )
        .unwrap();

        let meta = read_vault_meta(&path).unwrap();
        assert_eq!(meta.format_version, FORMAT_VERSION_V4);

        let loaded = open_multi_user_fixture(&path, &user, password.as_str()).unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.format_version, Some(FORMAT_VERSION_V4));
    }

    #[test]
    fn v4_tampered_users_json_fails_open() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("tamper.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();

        write_v3_vault_file(
            &path,
            "TamperVault",
            std::slice::from_ref(&user),
            dek.as_bytes(),
            &sample_payload().entries,
        )
        .unwrap();

        let (meta, _header_len) = parse_header(&fs::read(&path).unwrap()).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        let tamper_index = 4 + 2 + 2 + meta.name.len() + 4;
        bytes[tamper_index] ^= 0x01;
        fs::write(&path, &bytes).unwrap();

        let err = open_multi_user_fixture(&path, &user, password.as_str()).unwrap_err();
        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn v4_tampered_user_role_fails_open() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("role.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();

        write_v3_vault_file(
            &path,
            "RoleVault",
            std::slice::from_ref(&user),
            dek.as_bytes(),
            &sample_payload().entries,
        )
        .unwrap();

        let bytes = fs::read(&path).unwrap();
        let (meta, header_len) = parse_header(&bytes).unwrap();
        let mut users = meta.users.unwrap();
        users[0].role = UserRole::Member;
        let tampered_header = serialize_header_v4(
            FORMAT_VERSION_V4,
            &meta.name,
            &users,
            meta.key_created_at,
            meta.key_rotated_at,
        )
        .unwrap();
        let mut tampered = tampered_header;
        tampered.extend_from_slice(&bytes[header_len..]);
        fs::write(&path, tampered).unwrap();

        let meta = read_vault_meta(&path).unwrap();
        let err =
            open_multi_user_fixture(&path, &meta.users.unwrap()[0], password.as_str()).unwrap_err();
        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn v4_header_downgrade_detected() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("downgrade.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();
        let payload = sample_payload();
        let created = 1_700_000_000_u64;

        let plaintext_v4 = serialize_payload_v4_zeroizing(&payload.entries, None).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&dek, plaintext_v4.as_ref()).unwrap();
        let header_bytes = serialize_header_v4(
            FORMAT_VERSION_V3,
            "DowngradeVault",
            std::slice::from_ref(&user),
            created,
            0,
        )
        .unwrap();
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(&header_bytes).unwrap();
        file.write_all(&nonce).unwrap();
        file.write_all(&ciphertext).unwrap();
        file.sync_all().unwrap();

        let err = open_multi_user_fixture(&path, &user, password.as_str()).unwrap_err();
        assert!(matches!(err, VaultError::FormatDowngrade));
    }

    #[test]
    fn legacy_v3_open_persist_becomes_v4() {
        use crate::vault_user::{build_vault_user, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy-v3.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();
        let payload = sample_payload();
        let created = 1_700_000_000_u64;

        write_legacy_v3_vault_bytes(
            &path,
            "LegacyV3",
            std::slice::from_ref(&user),
            &dek,
            &payload.entries,
            created,
            0,
        )
        .unwrap();

        open_multi_user_fixture(&path, &user, password.as_str()).unwrap();

        update_v3_vault_file(
            &path,
            "LegacyV3",
            std::slice::from_ref(&user),
            &dek,
            &payload.entries,
            created,
            0,
        )
        .unwrap();

        let meta = read_vault_meta(&path).unwrap();
        assert_eq!(meta.format_version, FORMAT_VERSION_V4);
        let loaded = open_multi_user_fixture(&path, &user, password.as_str()).unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.format_version, Some(FORMAT_VERSION_V4));
    }

    #[test]
    fn legacy_v2_open_succeeds_and_persist_becomes_v4() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy-v2.oxid");
        let salt = random_salt();
        let kdf = KdfParams::default();
        let kek = MasterKey::derive_from_password("legacy-v2-password", &salt, kdf).unwrap();
        let dek = MasterKey::generate_data_key();
        let payload = sample_payload();
        let created = 1_700_000_000_u64;

        write_vault_file(
            &path,
            "LegacyV2",
            kdf,
            &salt,
            &kek,
            &dek,
            created,
            0,
            &payload.entries,
        )
        .unwrap();

        let (_, loaded) = read_vault_file(&path, &kek).unwrap();
        assert_eq!(loaded.entries.len(), 1);

        update_vault_file(
            &path,
            "LegacyV2",
            kdf,
            &salt,
            &dek,
            Some(&kek),
            FORMAT_VERSION_V2,
            created,
            0,
            &payload.entries,
        )
        .unwrap();

        let meta = read_vault_meta(&path).unwrap();
        assert_eq!(meta.format_version, FORMAT_VERSION_V2);
        let (_, reopened) = read_vault_file(&path, &kek).unwrap();
        assert_eq!(reopened.entries.len(), 1);
    }

    #[test]
    fn v4_password_rotation_reopens_with_new_password() {
        use crate::vault_user::{build_vault_user, rewrap_user_dek, UserRole};
        use zeroize::Zeroizing;

        let dir = tempdir().unwrap();
        let path = dir.path().join("rotate-v4.oxid");
        let old_password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let new_password = Zeroizing::new("brand-new-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let mut user =
            build_vault_user("admin", old_password.clone(), UserRole::Admin, &dek, None).unwrap();
        let payload = sample_payload();
        let created = 1_700_000_000_u64;

        write_v3_vault_file(
            &path,
            "RotateV4",
            std::slice::from_ref(&user),
            dek.as_bytes(),
            &payload.entries,
        )
        .unwrap();

        rewrap_user_dek(&mut user, old_password.clone(), new_password.clone(), &dek).unwrap();
        update_v3_vault_file(
            &path,
            "RotateV4",
            std::slice::from_ref(&user),
            &dek,
            &payload.entries,
            created,
            0,
        )
        .unwrap();

        open_multi_user_fixture(&path, &user, new_password.as_str()).unwrap();
        let err = open_multi_user_fixture(&path, &user, old_password.as_str()).unwrap_err();
        assert!(matches!(
            err,
            VaultError::InvalidUserPassword | VaultError::InvalidPassword
        ));
    }
}
