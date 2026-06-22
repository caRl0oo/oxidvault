// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der 
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht, 
// weitergeben und/oder modifizieren.

//! Length-prefixed JSON framing (shared by browser stdio and localhost IPC).

use std::io::{self, Read, Write};

/// Maximum inbound message size (1 MiB) — DoS guard for malformed length headers.
pub const MAX_MESSAGE_LEN: u32 = 1024 * 1024;

pub fn read_message(stdin: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match stdin.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_buf);
    if len == 0 || len > MAX_MESSAGE_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid native messaging frame length",
        ));
    }

    let mut payload = vec![0u8; len as usize];
    stdin.read_exact(&mut payload)?;
    Ok(Some(payload))
}

pub fn write_message(stdout: &mut impl Write, json: &[u8]) -> io::Result<()> {
    if json.len() > MAX_MESSAGE_LEN as usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response exceeds maximum native messaging frame size",
        ));
    }

    let len = u32::try_from(json.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "response length overflow"))?;

    stdout.write_all(&len.to_le_bytes())?;
    stdout.write_all(json)?;
    stdout.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn length_prefix_roundtrip() {
        let payload = br#"{"action":"ping"}"#;
        let mut buffer = Vec::new();
        write_message(&mut buffer, payload).expect("write frame");

        let mut cursor = Cursor::new(buffer);
        let decoded = read_message(&mut cursor)
            .expect("read frame")
            .expect("non-empty frame");
        assert_eq!(decoded, payload);
    }
}
