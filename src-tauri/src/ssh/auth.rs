// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

//! SSH user authentication (public key only).

use std::sync::Arc;

use russh::client::{self, AuthResult, Handler};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg};

/// Authenticates with explicit public-key auth (no automatic method negotiation).
pub async fn authenticate_publickey<H: Handler<Error = russh::Error>>(
    handle: &mut client::Handle<H>,
    username: &str,
    private_key: PrivateKey,
    passphrase_was_provided: bool,
) -> Result<(), String> {
    let username = username.trim();
    if username.is_empty() {
        return Err("SSH username is empty".into());
    }

    ensure_key_usable_for_auth(&private_key, passphrase_was_provided)?;

    let rsa_hash_candidates = rsa_hash_candidates(handle, &private_key).await?;
    let mut auth_rejected = false;

    for hash_alg in rsa_hash_candidates {
        let auth_key = PrivateKeyWithHashAlg::new(Arc::new(private_key.clone()), hash_alg);

        let auth = handle
            .authenticate_publickey(username, auth_key)
            .await
            .map_err(|_| "SSH authentication failed".to_string())?;

        match auth {
            AuthResult::Success => return Ok(()),
            AuthResult::Failure { .. } => {
                auth_rejected = true;
            }
        }
    }

    if auth_rejected {
        Err(
            "SSH authentication rejected. Verify the username and that the matching public key is in authorized_keys on the server.".into(),
        )
    } else {
        Err("SSH authentication failed".into())
    }
}

fn ensure_key_usable_for_auth(
    key: &PrivateKey,
    _passphrase_was_provided: bool,
) -> Result<(), String> {
    if key.is_encrypted() {
        return Err(
            "The private key is encrypted; enter the key passphrase in the vault entry".into(),
        );
    }
    Ok(())
}

async fn rsa_hash_candidates<H: Handler<Error = russh::Error>>(
    handle: &client::Handle<H>,
    key: &PrivateKey,
) -> Result<Vec<Option<HashAlg>>, String> {
    if !key.algorithm().is_rsa() {
        return Ok(vec![None]);
    }

    match handle.best_supported_rsa_hash().await {
        Ok(Some(preferred)) => Ok(vec![preferred]),
        Ok(None) => Ok(vec![Some(HashAlg::Sha512), Some(HashAlg::Sha256), None]),
        Err(_) => Err("SSH authentication failed: could not negotiate signature algorithm".into()),
    }
}
