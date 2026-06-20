//! Chrome/Firefox Native Messaging host (stdio, length-prefixed JSON).
//!
//! Protocol: 4-byte little-endian payload length, then UTF-8 JSON body.
//! stdout is reserved for responses only — never log to stdout in this mode.

use std::io;

use serde::{Deserialize, Serialize};

use crate::nm_bridge::{read_message, request_get_login, write_message, BridgeResponse};

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct IncomingMessage {
    action: String,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct OutgoingMessage {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl From<BridgeResponse> for OutgoingMessage {
    fn from(value: BridgeResponse) -> Self {
        Self {
            status: value.status,
            username: value.username,
            password: value.password,
            error: value.error,
        }
    }
}

/// Runs the blocking stdin/stdout loop until the browser closes the pipe (EOF).
pub fn run() -> io::Result<()> {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();

    while let Some(payload) = read_message(&mut stdin)? {
        let response = process_message(&payload);
        write_message(&mut stdout, &response)?;
    }

    Ok(())
}

fn process_message(payload: &[u8]) -> Vec<u8> {
    match serde_json::from_slice::<IncomingMessage>(payload) {
        Ok(IncomingMessage { action, url: _ }) if action == "ping" => {
            serialize_response(OutgoingMessage {
                status: "pong".into(),
                username: None,
                password: None,
                error: None,
            })
        }
        Ok(IncomingMessage { action, url }) if action == "get_login" => {
            let hostname = url.unwrap_or_default();
            if hostname.trim().is_empty() {
                return serialize_response(OutgoingMessage {
                    status: "error".into(),
                    username: None,
                    password: None,
                    error: Some("missing url".into()),
                });
            }
            serialize_response(OutgoingMessage::from(request_get_login(hostname.trim())))
        }
        Ok(_) => serialize_response(OutgoingMessage {
            status: "error".into(),
            username: None,
            password: None,
            error: Some("unknown action".into()),
        }),
        Err(e) => serialize_response(OutgoingMessage {
            status: "error".into(),
            username: None,
            password: None,
            error: Some(format!("invalid json: {e}")),
        }),
    }
}

fn serialize_response(message: OutgoingMessage) -> Vec<u8> {
    match serde_json::to_vec(&message) {
        Ok(bytes) => bytes,
        Err(_) => br#"{"status":"error","error":"internal serialization failure"}"#.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn parse_json(bytes: &[u8]) -> serde_json::Value {
        serde_json::from_slice(bytes).expect("valid outgoing json")
    }

    #[test]
    fn ping_returns_pong() {
        let response = process_message(br#"{"action":"ping"}"#);
        let value = parse_json(&response);
        assert_eq!(value.get("status").and_then(|v| v.as_str()), Some("pong"));
    }

    #[test]
    fn get_login_without_url_returns_error() {
        let response = process_message(br#"{"action":"get_login"}"#);
        let value = parse_json(&response);
        assert_eq!(value.get("status").and_then(|v| v.as_str()), Some("error"));
    }

    #[test]
    fn get_login_without_desktop_app_returns_unavailable() {
        let response = process_message(br#"{"action":"get_login","url":"example.com"}"#);
        let value = parse_json(&response);
        assert_eq!(
            value.get("status").and_then(|v| v.as_str()),
            Some("unavailable")
        );
    }

    #[test]
    fn unknown_action_returns_error() {
        let response = process_message(br#"{"action":"fill"}"#);
        let value = parse_json(&response);
        assert_eq!(value.get("status").and_then(|v| v.as_str()), Some("error"));
    }

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
