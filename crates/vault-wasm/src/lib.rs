// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

use vault_generator::{generate_password as generate, PasswordGenOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password_js(options: JsValue) -> Result<String, JsValue> {
    let opts: PasswordGenOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("invalid options: {e}")))?;
    generate(opts).map_err(|e| JsValue::from_str(&e.to_string()))
}
