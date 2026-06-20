use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::VaultError;

pub const KDF_MEMORY_KIB: u32 = 65536;
pub const KDF_ITERATIONS: u32 = 3;
pub const KDF_PARALLELISM: u32 = 4;
pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;

#[derive(Clone, Copy, Debug)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kib: KDF_MEMORY_KIB,
            iterations: KDF_ITERATIONS,
            parallelism: KDF_PARALLELISM,
        }
    }
}

/// Sensitive key material — never `Clone`, never `Debug`.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; KEY_LEN]);

impl MasterKey {
    pub fn derive_from_password(
        password: &str,
        salt: &[u8; SALT_LEN],
        params: KdfParams,
    ) -> Result<Self, VaultError> {
        let argon2 = Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            Params::new(
                params.memory_kib,
                params.iterations,
                params.parallelism,
                Some(KEY_LEN),
            )
            .map_err(|e| VaultError::Crypto(e.to_string()))?,
        );

        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        argon2
            .hash_password_into(password.as_bytes(), salt, key.as_mut())
            .map_err(|e| VaultError::Crypto(e.to_string()))?;

        Ok(Self(*key))
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn random_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

pub fn encrypt(
    key: &MasterKey,
    plaintext: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>), VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let nonce_bytes = random_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| VaultError::Crypto("encryption failed".into()))?;
    Ok((nonce_bytes, ciphertext))
}

/// Plaintext is wrapped in `Zeroizing` — heap is overwritten on drop.
pub fn decrypt(
    key: &MasterKey,
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| VaultError::InvalidPassword)?;
    Ok(Zeroizing::new(plaintext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let salt = random_salt();
        let key = MasterKey::derive_from_password("test-password", &salt, KdfParams::default())
            .unwrap();
        let (nonce, ct) = encrypt(&key, b"secret payload").unwrap();
        let pt = decrypt(&key, &nonce, &ct).unwrap();
        assert_eq!(&pt[..], b"secret payload");
    }

    #[test]
    fn wrong_password_fails_decrypt() {
        let salt = random_salt();
        let key = MasterKey::derive_from_password("correct", &salt, KdfParams::default()).unwrap();
        let wrong = MasterKey::derive_from_password("wrong", &salt, KdfParams::default()).unwrap();
        let (nonce, ct) = encrypt(&key, b"data").unwrap();
        assert!(decrypt(&wrong, &nonce, &ct).is_err());
    }
}
