// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use vault_generator::{generate_password as generate, PasswordGenOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password_js(options: JsValue) -> Result<String, JsValue> {
    let opts: PasswordGenOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("invalid options: {e}")))?;
    generate(opts).map_err(|e| JsValue::from_str(&e.to_string()))
}
