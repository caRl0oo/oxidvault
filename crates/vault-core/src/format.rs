// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! `.oxid` on-disk format — v4 only (multi-user, header AAD).

use std::fs;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, MasterKey, NONCE_LEN};
use crate::entry::SecretEntry;
use crate::error::VaultError;
use crate::mfa::StoredMfaConfig;
use crate::vault_user::VaultUser;

pub const MAGIC: &[u8; 4] = b"OXID";

/// Upper bound for the `users_json` header block — prevents multi-GiB allocations
/// from a tampered length field before any authentication happens.
const MAX_USERS_JSON_LEN: usize = 4 * 1024 * 1024;

pub const FORMAT_VERSION_V4: u16 = 4;

/// Returns true when the on-disk format is the supported v4 multi-user layout.
pub fn is_multi_user_format(format_version: u16) -> bool {
    format_version == FORMAT_VERSION_V4
}

#[derive(Debug, Clone)]
pub struct VaultFileMeta {
    pub name: String,
    pub format_version: u16,
    pub key_created_at: u64,
    pub key_rotated_at: u64,
    pub users: Vec<VaultUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub entries: Vec<SecretEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mfa: Option<StoredMfaConfig>,
    /// Present in v4 encrypted payloads — downgrade guard vs. on-disk header version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_version: Option<u16>,
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
    if format_version != FORMAT_VERSION_V4 {
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

/// Writes a new v4 vault file (fails if the path already exists).
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

/// Atomically rewrites an existing v4 vault file.
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

/// Decrypts a v4 multi-user vault payload (header bytes bound as AES-GCM AAD).
pub fn decrypt_multi_user_payload(
    dek: &MasterKey,
    payload_nonce: &[u8],
    payload_ciphertext: &[u8],
    header_format_version: u16,
    header_aad: &[u8],
) -> Result<VaultPayload, VaultError> {
    if header_format_version != FORMAT_VERSION_V4 {
        return Err(VaultError::UnsupportedLegacyFormat {
            version: header_format_version,
        });
    }
    if payload_nonce.len() != NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(payload_nonce);
    if payload_ciphertext.is_empty() {
        return Err(VaultError::InvalidFormat);
    }

    let plaintext = crypto::decrypt_with_aad(dek, &nonce, payload_ciphertext, header_aad)?;
    let payload: VaultPayload =
        serde_json::from_slice(plaintext.as_ref()).map_err(|_| VaultError::InvalidFormat)?;
    verify_payload_format_version(header_format_version, &payload)?;
    Ok(payload)
}

/// Structural parse result for a v4 `.oxid` file (header + payload split; no decryption).
#[derive(Debug, Clone)]
pub struct ParsedVaultFile {
    pub meta: VaultFileMeta,
    pub header_len: usize,
    pub payload_nonce: [u8; NONCE_LEN],
    pub payload_ciphertext: Vec<u8>,
}

/// Parsed v4 vault file on disk: plaintext user table in the header plus the
/// still-encrypted payload block (nonce + ciphertext) that follows the header bytes.
#[derive(Debug, Clone)]
pub struct MultiUserVaultFile {
    pub users: Vec<VaultUser>,
    pub header_aad: Vec<u8>,
    pub format_version: u16,
    pub payload_nonce: [u8; NONCE_LEN],
    pub payload_ciphertext: Vec<u8>,
}

/// Parses a v4 vault file from untrusted bytes: magic, header, `users_json` (incl. base64
/// field validation), and payload nonce/ciphertext split. Does not decrypt the payload.
pub fn parse_vault_file_bytes(data: &[u8]) -> Result<ParsedVaultFile, VaultError> {
    let (meta, header_len) = parse_header(data)?;
    crate::vault_user::validate_users_json_fields(&meta.users)?;

    let payload_blob = &data[header_len..];
    if payload_blob.len() <= NONCE_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let (nonce_bytes, ciphertext) = payload_blob.split_at(NONCE_LEN);
    let mut payload_nonce = [0u8; NONCE_LEN];
    payload_nonce.copy_from_slice(nonce_bytes);

    Ok(ParsedVaultFile {
        meta,
        header_len,
        payload_nonce,
        payload_ciphertext: ciphertext.to_vec(),
    })
}

pub fn read_raw_vault(path: &Path) -> Result<(VaultFileMeta, Vec<u8>), VaultError> {
    let bytes = fs::read(path)?;
    let parsed = parse_vault_file_bytes(&bytes)?;
    Ok((parsed.meta, bytes[parsed.header_len..].to_vec()))
}

pub fn read_vault_meta(path: &Path) -> Result<VaultFileMeta, VaultError> {
    let bytes = fs::read(path)?;
    parse_vault_file_bytes(&bytes).map(|parsed| parsed.meta)
}

/// Reads a v4 vault header and encrypted payload parts.
pub fn read_multi_user_vault_file(path: &Path) -> Result<MultiUserVaultFile, VaultError> {
    let bytes = fs::read(path)?;
    let parsed = parse_vault_file_bytes(&bytes)?;
    Ok(MultiUserVaultFile {
        users: parsed.meta.users,
        header_aad: bytes[..parsed.header_len].to_vec(),
        format_version: parsed.meta.format_version,
        payload_nonce: parsed.payload_nonce,
        payload_ciphertext: parsed.payload_ciphertext,
    })
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

pub(crate) fn copy_temp_over_target(
    temp_path: &Path,
    target_path: &Path,
) -> Result<(), VaultError> {
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

pub(crate) fn parse_header(bytes: &[u8]) -> Result<(VaultFileMeta, usize), VaultError> {
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
    if format_version != FORMAT_VERSION_V4 {
        return Err(VaultError::UnsupportedLegacyFormat {
            version: format_version,
        });
    }

    read_header_v4(reader, format_version)
}

fn read_header_v4(
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
    if users_size > MAX_USERS_JSON_LEN {
        return Err(VaultError::InvalidFormat);
    }
    let mut users_buf = vec![0u8; users_size];
    reader.read_exact(&mut users_buf)?;
    let users: Vec<VaultUser> =
        serde_json::from_slice(&users_buf).map_err(|_| VaultError::InvalidFormat)?;
    crate::vault_user::validate_users_json_fields(&users)?;

    Ok(VaultFileMeta {
        name,
        format_version,
        key_created_at: u64::from_le_bytes(created),
        key_rotated_at: u64::from_le_bytes(rotated),
        users,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::MasterKey;
    use crate::entry::{SecretEntry, SecretEntryInput, SecretPayload};
    use crate::vault_user::{build_vault_user, UserRole};
    use std::io::Write;
    use tempfile::tempdir;
    use zeroize::Zeroizing;

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

    fn open_multi_user_fixture(
        path: &Path,
        user: &crate::vault_user::VaultUser,
        password: &str,
    ) -> Result<VaultPayload, VaultError> {
        use crate::vault_user::unwrap_user_dek;

        let file = read_multi_user_vault_file(path)?;
        let kdf = crate::crypto::KdfParams {
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

    fn write_legacy_header_only(path: &Path, format_version: u16) {
        let password = Zeroizing::new("legacy-password".to_string());
        let dek = MasterKey::generate_data_key();
        let user =
            build_vault_user("admin", password.clone(), UserRole::Admin, &dek, None).unwrap();
        let header =
            serialize_header_v4(format_version, "Legacy", &[user], 0, 0).unwrap_or_else(|_| {
                let mut header = Vec::new();
                header.extend_from_slice(MAGIC);
                header.extend_from_slice(&format_version.to_le_bytes());
                header.extend_from_slice(&5u16.to_le_bytes());
                header.extend_from_slice(b"Legacy");
                header.extend_from_slice(&0u64.to_le_bytes());
                header.extend_from_slice(&0u64.to_le_bytes());
                header.extend_from_slice(&2u32.to_le_bytes());
                header.extend_from_slice(b"[]");
                header
            });
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&header).unwrap();
        file.write_all(&[0u8; NONCE_LEN]).unwrap();
        file.write_all(b"x").unwrap();
        file.sync_all().unwrap();
    }

    #[test]
    fn legacy_format_versions_rejected_at_parse() {
        let dir = tempdir().unwrap();
        for version in [1u16, 2, 3] {
            let path = dir.path().join(format!("legacy-v{version}.oxid"));
            write_legacy_header_only(&path, version);
            let err = read_vault_meta(&path).unwrap_err();
            assert!(
                matches!(err, VaultError::UnsupportedLegacyFormat { version: v } if v == version),
                "v{version}: {err:?}"
            );
        }
    }

    #[test]
    fn v4_vault_file_roundtrip() {
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

        let bytes = fs::read(&path).unwrap();
        let (meta, header_len) = parse_header(&bytes).unwrap();
        let mut users = meta.users;
        users[0].username = "adminx".to_string();
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

        let err = open_multi_user_fixture(&path, &user, password.as_str()).unwrap_err();
        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn v4_tampered_user_role_fails_open() {
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
        let mut users = meta.users;
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
        let err = open_multi_user_fixture(&path, &meta.users[0], password.as_str()).unwrap_err();
        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn v4_header_downgrade_detected() {
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
            FORMAT_VERSION_V4,
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

        let mut bytes = fs::read(&path).unwrap();
        bytes[4] = 3;
        fs::write(&path, bytes).unwrap();

        let err = read_vault_meta(&path).unwrap_err();
        assert!(matches!(
            err,
            VaultError::UnsupportedLegacyFormat { version: 3 }
        ));
    }

    #[test]
    fn v4_password_rotation_reopens_with_new_password() {
        use crate::vault_user::{rewrap_user_dek, UserRole};

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

    #[test]
    fn written_vault_is_always_format_v4() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("only-v4.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user = build_vault_user("admin", password, UserRole::Admin, &dek, None).unwrap();
        write_v3_vault_file(&path, "OnlyV4", &[user], dek.as_bytes(), &[]).unwrap();
        let meta = read_vault_meta(&path).unwrap();
        assert_eq!(meta.format_version, FORMAT_VERSION_V4);
    }

    #[test]
    fn parse_vault_file_bytes_matches_path_reader() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bytes.oxid");
        let password = Zeroizing::new("correct-horse-battery-staple".to_string());
        let dek = MasterKey::generate_data_key();
        let user = build_vault_user("admin", password, UserRole::Admin, &dek, None).unwrap();
        write_v3_vault_file(&path, "BytesVault", &[user], dek.as_bytes(), &[]).unwrap();

        let bytes = fs::read(&path).unwrap();
        let parsed = parse_vault_file_bytes(&bytes).unwrap();
        let from_path = read_multi_user_vault_file(&path).unwrap();
        assert_eq!(parsed.meta.format_version, from_path.format_version);
        assert_eq!(parsed.payload_nonce, from_path.payload_nonce);
        assert_eq!(parsed.payload_ciphertext, from_path.payload_ciphertext);
    }

    #[test]
    #[ignore = "run manually to refresh fuzz/corpus/vault_format seeds"]
    fn write_fuzz_vault_corpus_seeds() {
        use std::path::PathBuf;

        let dir = tempdir().unwrap();
        let path = dir.path().join("minimal.oxid");
        let password = Zeroizing::new("fuzz-corpus-password".to_string());
        let dek = MasterKey::generate_data_key();
        let user = build_vault_user("admin", password, UserRole::Admin, &dek, None).unwrap();
        write_v3_vault_file(&path, "FuzzSeed", &[user], dek.as_bytes(), &[]).unwrap();
        let bytes = fs::read(&path).unwrap();

        let corpus_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fuzz/corpus/vault_format");
        fs::create_dir_all(&corpus_dir).unwrap();
        fs::write(corpus_dir.join("minimal_v4.oxid"), &bytes).unwrap();

        let mut truncated = bytes.clone();
        truncated.truncate(bytes.len() / 2);
        fs::write(corpus_dir.join("truncated_v4.oxid"), &truncated).unwrap();

        let mut bad_magic = bytes;
        bad_magic[0] = b'X';
        fs::write(corpus_dir.join("bad_magic.oxid"), &bad_magic).unwrap();
    }
}
