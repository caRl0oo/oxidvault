#![no_main]

use libfuzzer_sys::fuzz_target;
use vault_core::format::parse_vault_file_bytes;

fuzz_target!(|data: &[u8]| {
    let _ = parse_vault_file_bytes(data);
});
