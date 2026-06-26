// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

mod bridge_state;
mod client;
mod focus;
mod framing;
mod protocol;
mod server;
mod session;

pub use bridge_state::BridgeAuthState;

pub use client::{
    emit_new_secret_prefill_if_pending, request_get_login, request_open_new_secret, request_unlock,
    request_vault_status,
};
pub use framing::{read_message, write_message};
pub use protocol::BridgeResponse;
pub use server::spawn_server;
