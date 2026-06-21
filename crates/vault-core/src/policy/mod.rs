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
