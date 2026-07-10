#![no_main]

use libfuzzer_sys::fuzz_target;
use vault_core::{parse_audit_log_bytes, verify_audit_chain_bytes};

fuzz_target!(|data: &[u8]| {
    let _ = parse_audit_log_bytes(data);
    let _ = verify_audit_chain_bytes(data);
});
