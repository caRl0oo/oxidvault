#![no_main]

use libfuzzer_sys::fuzz_target;
use vault_core::parse_ssh_private_key_bytes;

fuzz_target!(|data: &[u8]| {
    let _ = parse_ssh_private_key_bytes(data);
});
