# OxidVault — Native-Messaging-Host in der Windows-Registry registrieren (Chrome / Edge)
param(
    [Parameter(Mandatory = $false, HelpMessage = "32-stellige Extension-ID von chrome://extensions (unpacked dev build)")]
    [string]$ExtensionId = "",

    [ValidateSet("release", "debug", "installed")]
    [string]$BuildProfile = "release",

    [string]$InstallRoot = "$env:ProgramFiles\OxidVault"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "native-messaging-host.ps1")

$root = Get-OxidVaultRepoRoot
$hostDir = Join-Path $root "browser-extension\host"
$hostManifestPath = Join-Path $hostDir "com.oxidvault.app.json"

function Resolve-DevExtensionId {
    param([string]$ExplicitId)

    if ($ExplicitId) {
        return $ExplicitId.Trim()
    }
    if ($env:OXIDVAULT_EXTENSION_ID) {
        return $env:OXIDVAULT_EXTENSION_ID.Trim()
    }
    $idFile = Join-Path $root "browser-extension\extension.id"
    if (Test-Path $idFile) {
        return ([System.IO.File]::ReadAllText($idFile)).Trim()
    }
    return $null
}

$exePath = switch ($BuildProfile) {
    "installed" {
        [System.IO.Path]::GetFullPath((Join-Path $InstallRoot "oxidvault-nmh.exe"))
    }
    "debug" {
        [System.IO.Path]::GetFullPath((Join-Path $root "target\debug\oxidvault-nmh.exe"))
    }
    default {
        [System.IO.Path]::GetFullPath((Join-Path $root "target\release\oxidvault-nmh.exe"))
    }
}

if (-not (Test-Path $exePath)) {
    Write-Error @"
oxidvault-nmh.exe nicht gefunden: $exePath

Dev-Build:
  cargo build --release

MSI-Installation:
  .\scripts\register_native_host.ps1 -BuildProfile installed
"@
}

$devId = Resolve-DevExtensionId -ExplicitId $ExtensionId
$allowedOrigins = Get-OxidVaultNativeMessagingAllowedOrigins -DevExtensionId $devId

if (-not (Test-Path $hostDir)) {
    New-Item -ItemType Directory -Path $hostDir -Force | Out-Null
}

$hostManifest = [ordered]@{
    name            = "com.oxidvault.app"
    description     = "OxidVault Native Messaging Host"
    path            = $exePath
    type            = "stdio"
    allowed_origins = $allowedOrigins
}

$json = ($hostManifest | ConvertTo-Json -Depth 5)
[System.IO.File]::WriteAllText($hostManifestPath, $json, [System.Text.UTF8Encoding]::new($false))

$hostManifestFull = [System.IO.Path]::GetFullPath($hostManifestPath)

$registryTargets = @(
    @{ Browser = "Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.oxidvault.app" },
    @{ Browser = "Edge";   Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.oxidvault.app" }
)

foreach ($target in $registryTargets) {
    New-Item -Path $target.Path -Force | Out-Null
    Set-ItemProperty -Path $target.Path -Name "(default)" -Value $hostManifestFull
    Write-Host "[$($target.Browser)] Registry gesetzt: $($target.Path)"
}

Write-Host ""
Write-Host "Native Host registriert."
Write-Host "  Host-Manifest : $hostManifestFull"
Write-Host "  Binary        : $exePath"
Write-Host "  allowed_origins:"
foreach ($origin in $allowedOrigins) {
    Write-Host "    $origin"
}
Write-Host ""
Write-Host "Store-Extension: immer enthalten (chrome-store-extension.id)."
if ($devId) {
    Write-Host "Dev-Extension : $devId (zusaetzlich, falls abweichend von Store-ID)."
} else {
    Write-Host "Dev-Extension : nicht gesetzt — nur Store-ID aktiv."
    Write-Host "  Optional: browser-extension/extension.id oder -ExtensionId fuer unpacked builds."
}
