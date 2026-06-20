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
    use crate::error::VaultError;

    #[test]
    fn test_kdf_derivation() {
        let salt = [0x42u8; SALT_LEN];
        let params = KdfParams::default();

        let key_a =
            MasterKey::derive_from_password("correct-horse-battery-staple", &salt, params).unwrap();
        let key_b =
            MasterKey::derive_from_password("correct-horse-battery-staple", &salt, params).unwrap();

        assert_eq!(key_a.as_bytes(), key_b.as_bytes());
    }

    #[test]
    fn test_encrypt_decrypt_success() {
        let password = "vault-integration-test-password";
        let salt = [0x11u8; SALT_LEN];
        let plaintext = b"OxidVault secret payload - AES-256-GCM roundtrip";
        let params = KdfParams::default();

        let key = MasterKey::derive_from_password(password, &salt, params).unwrap();
        let (nonce, ciphertext) = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &nonce, &ciphertext).unwrap();

        assert_eq!(&decrypted[..], plaintext);
    }

    #[test]
    fn test_decrypt_invalid_password() {
        let salt = [0x99u8; SALT_LEN];
        let params = KdfParams::default();

        let correct_key = MasterKey::derive_from_password("correct", &salt, params).unwrap();
        let wrong_key = MasterKey::derive_from_password("wrong", &salt, params).unwrap();

        let (nonce, ciphertext) = encrypt(&correct_key, b"protected data").unwrap();
        let err = decrypt(&wrong_key, &nonce, &ciphertext).unwrap_err();

        assert!(matches!(err, VaultError::InvalidPassword));
    }

    #[test]
    fn test_nonce_uniqueness() {
        let salt = [0xABu8; SALT_LEN];
        let key = MasterKey::derive_from_password("nonce-test", &salt, KdfParams::default()).unwrap();
        let plaintext = b"same plaintext for both encryptions";

        let (nonce_a, ciphertext_a) = encrypt(&key, plaintext).unwrap();
        let (nonce_b, ciphertext_b) = encrypt(&key, plaintext).unwrap();

        assert_ne!(nonce_a, nonce_b, "each encrypt must draw a fresh random nonce");
        assert_ne!(
            ciphertext_a, ciphertext_b,
            "identical plaintext must produce distinct ciphertext when nonces differ"
        );
    }
}
