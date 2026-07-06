// Copyright (C) 2026 [Pascal Kuhn]
// Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
// GNU Affero General Public License, wie von der Free Software Foundation veröffentlicht,
// weitergeben und/oder modifizieren.

use std::path::{Path, PathBuf};

const PLACEHOLDER: &str = "__CHROME_STORE_EXTENSION_ID__";

fn repo_root(manifest_dir: &Path) -> &Path {
    manifest_dir
        .parent()
        .expect("CARGO_MANIFEST_DIR (src-tauri) must have a parent")
}

fn read_store_extension_id(root: &Path) -> String {
    let id_path = root.join("browser-extension/chrome-store-extension.id");
    let id = std::fs::read_to_string(&id_path).unwrap_or_else(|e| {
        panic!(
            "Chrome Web Store extension ID file not found or unreadable: {} ({e})",
            id_path.display()
        )
    });
    let id = id.trim();
    if id.len() != 32 || !id.chars().all(|c| ('a'..='p').contains(&c)) {
        panic!(
            "Invalid Chrome Web Store extension ID in {} (expected 32 lowercase a-p letters)",
            id_path.display()
        );
    }
    id.to_string()
}

fn write_if_changed(path: &Path, content: &str) {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    if existing != content {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", parent.display()));
        }
        std::fs::write(path, content)
            .unwrap_or_else(|e| panic!("failed to write {}: {e}", path.display()));
        println!("cargo:warning=rendered {}", path.display());
    }
}

/// Render gitignored WiX/PS1 artifacts from `.in` templates before `tauri_build` validates bundle paths.
fn render_native_messaging_artifacts(manifest_dir: &Path) {
    let root = repo_root(manifest_dir);
    let wix_dir = manifest_dir.join("wix");
    let id_path = root.join("browser-extension/chrome-store-extension.id");
    let wxs_template_path = wix_dir.join("native_messaging.wxs.in");
    let ps1_template_path = wix_dir.join("install-native-messaging-host.ps1.in");
    let wxs_path = wix_dir.join("native_messaging.wxs");
    let ps1_path = wix_dir.join("install-native-messaging-host.ps1");

    println!("cargo:rerun-if-changed={}", id_path.display());
    println!("cargo:rerun-if-changed={}", wxs_template_path.display());
    println!("cargo:rerun-if-changed={}", ps1_template_path.display());

    let store_id = read_store_extension_id(root);

    let wxs_template = std::fs::read_to_string(&wxs_template_path).unwrap_or_else(|e| {
        panic!(
            "WiX template not found: {} ({e})",
            wxs_template_path.display()
        )
    });
    let ps1_template = std::fs::read_to_string(&ps1_template_path).unwrap_or_else(|e| {
        panic!(
            "Install script template not found: {} ({e})",
            ps1_template_path.display()
        )
    });
    if !ps1_template.contains(PLACEHOLDER) {
        panic!(
            "Install script template missing placeholder {PLACEHOLDER}: {}",
            ps1_template_path.display()
        );
    }

    write_if_changed(&wxs_path, &wxs_template);
    write_if_changed(&ps1_path, &ps1_template.replace(PLACEHOLDER, &store_id));
}

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set"));
    render_native_messaging_artifacts(&manifest_dir);
    tauri_build::build()
}
