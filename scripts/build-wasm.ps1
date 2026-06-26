# Builds vault-wasm for the browser extension (wasm-pack required).
param(
    [switch]$InstallWasmPack
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root "browser-extension\pkg"

if ($InstallWasmPack) {
    cargo install wasm-pack
}

if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Error "wasm-pack not found. Install via: cargo install wasm-pack"
}

Push-Location $Root
try {
    wasm-pack build crates/vault-wasm --target web --out-dir $OutDir --release
    Write-Host "WASM build complete: $OutDir"
} finally {
    Pop-Location
}
