//! `.oxid` on-disk format — v1 (direct key) and v2 (wrapped DEK header).
#![allow(clippy::too_many_arguments)]

use std::fs;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, MasterKey, NONCE_LEN, SALT_LEN};
use crate::entry::SecretEntry;
use crate::error::VaultError;

pub const MAGIC: &[u8; 4] = b"OXID";
pub const FORMAT_VERSION_V1: u16 = 1;
pub const FORMAT_VERSION_V2: u16 = 2;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub entries: Vec<SecretEntry>,
}

#[derive(Serialize)]
struct VaultPayloadRef<'a> {
    entries: &'a [SecretEntry],
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

fn serialize_entries_zeroizing(entries: &[SecretEntry]) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    Ok(Zeroizing::new(
        serde_json::to_vec(&VaultPayloadRef { entries })
            .map_err(|e| VaultError::Other(e.to_string()))?,
    ))
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
        entries,
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
        entries,
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
        entries,
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
) -> Result<(), VaultError> {
    let tmp_path = temp_vault_path(path)?;

    if let Err(error) = write_vault_bytes_with_context(&tmp_path, context, entries) {
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
) -> Result<(), VaultError> {
    let plaintext = serialize_entries_zeroizing(entries)?;
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
        _ => Err(VaultError::InvalidFormat),
    }
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
    if format_version != FORMAT_VERSION_V1 && format_version != FORMAT_VERSION_V2 {
        return Err(VaultError::InvalidFormat);
    }

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
}
