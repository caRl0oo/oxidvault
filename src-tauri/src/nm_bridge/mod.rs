// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

mod client;
mod framing;
mod protocol;
mod server;
mod session;

pub use client::request_get_login;
pub use framing::{read_message, write_message};
pub use protocol::BridgeResponse;
pub use server::spawn_server;
