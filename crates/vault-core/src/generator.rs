// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use crate::error::VaultError;

pub use vault_generator::{
    generate_password as generate_password_inner, PasswordGenOptions, DEFAULT_PASSWORD_LENGTH,
};

/// Generates a cryptographically secure random password using `OsRng` (CSPRNG).
pub fn generate_password(opts: PasswordGenOptions) -> Result<String, VaultError> {
    generate_password_inner(opts).map_err(|e| VaultError::Other(e.to_string()))
}
