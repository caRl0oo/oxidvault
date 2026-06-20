use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, MasterKey, NONCE_LEN, SALT_LEN};
use crate::entry::SecretEntry;
use crate::error::VaultError;

pub const MAGIC: &[u8; 4] = b"OXID";
pub const FORMAT_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub entries: Vec<SecretEntry>,
}

#[derive(Debug, Clone)]
pub struct VaultFileMeta {
    pub name: String,
    pub kdf: KdfParams,
    pub salt: [u8; SALT_LEN],
}

#[derive(Serialize)]
struct VaultPayloadRef<'a> {
    entries: &'a [SecretEntry],
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
    key: &MasterKey,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    if path.exists() {
        return Err(VaultError::FileExists);
    }
    atomic_write_vault(path, name, kdf, salt, key, entries)
}

pub fn update_vault_file(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    key: &MasterKey,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    atomic_write_vault(path, name, kdf, salt, key, entries)
}

/// Writes encrypted vault data atomically: temp file → fsync → rename over target.
fn atomic_write_vault(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    key: &MasterKey,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    let tmp_path = temp_vault_path(path);
    if let Err(e) = write_vault_bytes(&tmp_path, name, kdf, salt, key, entries) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        VaultError::Io(e)
    })
}

fn temp_vault_path(path: &Path) -> PathBuf {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    PathBuf::from(tmp)
}

fn write_vault_bytes(
    path: &Path,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
    key: &MasterKey,
    entries: &[SecretEntry],
) -> Result<(), VaultError> {
    let plaintext = serialize_entries_zeroizing(entries)?;
    let (nonce, ciphertext) = crypto::encrypt(key, plaintext.as_ref())?;

    let mut file = fs::File::create(path)?;
    write_header(&mut file, name, kdf, salt)?;
    file.write_all(&nonce)?;
    file.write_all(&ciphertext)?;
    file.sync_all()?;
    Ok(())
}

pub fn read_vault_file(path: &Path, key: &MasterKey) -> Result<(VaultFileMeta, VaultPayload), VaultError> {
    let mut file = fs::File::open(path)?;
    let meta = read_header(&mut file)?;
    let mut nonce = [0u8; NONCE_LEN];
    file.read_exact(&mut nonce)?;
    let mut ciphertext = Vec::new();
    file.read_to_end(&mut ciphertext)?;

    if ciphertext.is_empty() {
        return Err(VaultError::InvalidFormat);
    }

    let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
    let payload: VaultPayload =
        serde_json::from_slice(plaintext.as_ref()).map_err(|_| VaultError::InvalidFormat)?;

    Ok((meta, payload))
}

pub fn read_vault_meta(path: &Path) -> Result<VaultFileMeta, VaultError> {
    let mut file = fs::File::open(path)?;
    read_header(&mut file)
}

fn write_header(
    writer: &mut impl Write,
    name: &str,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
) -> Result<(), VaultError> {
    let name_bytes = name.as_bytes();
    if name_bytes.len() > u16::MAX as usize {
        return Err(VaultError::Other("vault name too long".into()));
    }

    writer.write_all(MAGIC)?;
    writer.write_all(&FORMAT_VERSION.to_le_bytes())?;
    writer.write_all(&kdf.memory_kib.to_le_bytes())?;
    writer.write_all(&kdf.iterations.to_le_bytes())?;
    writer.write_all(&kdf.parallelism.to_le_bytes())?;
    writer.write_all(salt)?;
    writer.write_all(&(name_bytes.len() as u16).to_le_bytes())?;
    writer.write_all(name_bytes)?;
    Ok(())
}

fn read_header(reader: &mut impl Read) -> Result<VaultFileMeta, VaultError> {
    let mut magic = [0u8; 4];
    reader.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Err(VaultError::InvalidFormat);
    }

    let mut version = [0u8; 2];
    reader.read_exact(&mut version)?;
    if u16::from_le_bytes(version) != FORMAT_VERSION {
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

    Ok(VaultFileMeta {
        name,
        kdf: KdfParams {
            memory_kib: u32::from_le_bytes(memory),
            iterations: u32::from_le_bytes(iterations),
            parallelism: u32::from_le_bytes(parallelism),
        },
        salt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{MasterKey, random_salt};
    use crate::entry::{SecretEntry, SecretEntryInput, SecretPayload};
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
        write_vault_file(&path, "MyVault", kdf, &salt, &key, &payload.entries).unwrap();

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

        write_vault_file(&path, "MyVault", kdf, &salt, &key, &sample_payload().entries).unwrap();
        assert!(path.exists());
        assert!(!temp_vault_path(&path).exists());

        update_vault_file(
            &path,
            "MyVault",
            kdf,
            &salt,
            &key,
            &sample_payload().entries,
        )
        .unwrap();
        assert!(path.exists());
        assert!(!temp_vault_path(&path).exists());
    }
}
