// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

//! Policy enforcement — master-password rules and machine-wide admin GPO overrides.

mod admin;
mod password;

pub use admin::{
    admin_policy, admin_policy_active, admin_policy_path, init_admin_policy, load_admin_policy,
    resolve_config, resolve_config_with_admin, AdminPolicy, ResolvedBoolField, ResolvedConfig,
    ResolvedU32Field, UserPolicyPreferences,
};
pub use password::{
    validate_master_password, validate_master_password_with_min_len, MIN_MASTER_PASSWORD_LEN,
};

/// Minimum master/user password length after applying the machine-wide admin GPO.
///
/// Applies to every password-set path: `create_v3`, `add_user`,
/// and per-user password changes (`rewrap_user_dek`).
pub fn effective_min_master_password_len() -> usize {
    admin_policy()
        .min_master_password_len
        .map(|value| value as usize)
        .unwrap_or(MIN_MASTER_PASSWORD_LEN)
}

/// Argon2id parameters for new user credentials (create, add user, password change).
///
/// Admin policy `kdfMemoryMib` (64–1024 MiB) overrides the 128 MiB default when set.
pub fn effective_kdf_params_for_new_vaults() -> crate::crypto::KdfParams {
    let memory_mib = admin_policy()
        .kdf_memory_mib
        .map(clamp_kdf_memory_mib)
        .unwrap_or(crate::crypto::KDF_MEMORY_KIB / 1024);
    crate::crypto::KdfParams {
        memory_kib: memory_mib.saturating_mul(1024),
        iterations: crate::crypto::KDF_ITERATIONS,
        parallelism: crate::crypto::KDF_PARALLELISM,
    }
}

fn clamp_kdf_memory_mib(value: u32) -> u32 {
    value.clamp(64, 1024)
}
