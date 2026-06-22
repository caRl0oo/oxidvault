# Packages browser-extension/ as a ZIP for Chrome Web Store upload (unlisted).
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "installer\dist"),
    [switch]$SkipWasm
)

$ErrorActionPreference = "Stop"

$extensionDir = Join-Path $Root "browser-extension"
$manifestPath = Join-Path $extensionDir "manifest.json"

if (-not (Test-Path $manifestPath)) {
    Write-Error "manifest.json not found: $manifestPath"
}

if (-not $SkipWasm) {
    & (Join-Path $PSScriptRoot "build-wasm.ps1")
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.PSObject.Properties.Name -contains "key") {
    Write-Error "manifest.json must not contain 'key' for Web Store upload. Remove it and retry."
}
if ($manifest.PSObject.Properties.Name -contains "update_url") {
    Write-Error "manifest.json must not contain 'update_url' for Web Store upload. Remove it and retry."
}

$version = [string]$manifest.version
$zipName = "OxidVault-extension-$version.zip"
$zipPath = Join-Path $OutDir $zipName

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$excludeNames = @("keys", "host", "README.md", "extension.id", "extension.id.example")
$stageRoot = Join-Path $OutDir "_stage"
if (Test-Path $stageRoot) {
    Remove-Item -Path $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

Get-ChildItem -Path $extensionDir -Force | Where-Object {
    $excludeNames -notcontains $_.Name
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $stageRoot -Recurse -Force
}

$requiredWasmFiles = @(
    (Join-Path $stageRoot "pkg\vault_wasm.js"),
    (Join-Path $stageRoot "pkg\vault_wasm_bg.wasm")
)
foreach ($required in $requiredWasmFiles) {
    if (-not (Test-Path $required)) {
        Write-Error @"
WASM artifacts missing in staged package: $required
Run without -SkipWasm, or execute: .\scripts\build-wasm.ps1
"@
    }
}

$remoteCodePatterns = @(
    'https?://[^\s''"]+',
    'file://[^\s''"]+'
)
$scanRoots = @(
    (Join-Path $stageRoot "background.js"),
    (Join-Path $stageRoot "content.js"),
    (Join-Path $stageRoot "popup.js"),
    (Join-Path $stageRoot "popup.html"),
    (Join-Path $stageRoot "manifest.json")
)
foreach ($scanFile in $scanRoots) {
    if (-not (Test-Path $scanFile)) {
        continue
    }
    $content = [System.IO.File]::ReadAllText($scanFile)
    foreach ($pattern in $remoteCodePatterns) {
        if ($content -match $pattern) {
            Write-Error "External URL reference in staged file ${scanFile}: matched '$($Matches[0])'"
        }
    }
}

if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageRoot, $zipPath)

Remove-Item -Path $stageRoot -Recurse -Force

Write-Host ""
Write-Host "Chrome Web Store package ready:"
Write-Host "  ZIP     : $zipPath"
Write-Host "  Version : $version"
Write-Host "  WASM    : pkg/vault_wasm_bg.wasm (bundled, extension-local)"
Write-Host ""
Write-Host "Remote code checklist: all JS/WASM is inside the ZIP; no http(s) URLs in sources."
Write-Host "Web Store question 'Uses remote code?' -> No (WASM is shipped in the package)."
Write-Host ""
Write-Host "Upload at: https://chrome.google.com/webstore/devconsole"
Write-Host "After publish, save the extension ID to browser-extension/extension.id"
Write-Host "  (see extension.id.example) and run register_native_host.ps1 -ExtensionId <ID>"
