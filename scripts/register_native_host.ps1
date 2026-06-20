# OxidVault — Native-Messaging-Host in der Windows-Registry registrieren (Chrome / Edge)
param(
    [Parameter(Mandatory = $false, HelpMessage = "32-stellige Extension-ID von chrome://extensions")]
    [string]$ExtensionId = "",

    [ValidateSet("release", "debug")]
    [string]$BuildProfile = "release"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$hostDir = Join-Path $root "browser-extension\host"
$hostManifestPath = Join-Path $hostDir "com.oxidvault.app.json"

$exeSubdir = if ($BuildProfile -eq "debug") { "debug" } else { "release" }
$exePath = [System.IO.Path]::GetFullPath((Join-Path $root "target\$exeSubdir\oxidvault-nmh.exe"))

if (-not (Test-Path $exePath)) {
    Write-Error @"
oxidvault-nmh.exe nicht gefunden: $exePath

Bitte zuerst bauen:
  cargo build --$BuildProfile
"@
}

if ($ExtensionId -and $ExtensionId -notmatch '^[a-p]{32}$') {
    Write-Error "ExtensionId muss 32 Kleinbuchstaben (a-p) sein — kopiere sie von chrome://extensions."
}

$allowedOrigin = if ($ExtensionId) {
    "chrome-extension://$ExtensionId/"
} else {
    Write-Warning "Keine -ExtensionId angegeben. allowed_origins bleibt ein Platzhalter — Native Messaging schlägt fehl, bis du die ID nachreichst."
    "chrome-extension://YOUR_EXTENSION_ID_HERE/"
}

$hostManifest = [ordered]@{
    name             = "com.oxidvault.app"
    description      = "OxidVault Native Messaging Host (Phase 2 ping/pong)"
    path             = $exePath
    type             = "stdio"
    allowed_origins  = @($allowedOrigin)
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
Write-Host "  allowed_origins: $allowedOrigin"
Write-Host ""
Write-Host "Nächster Schritt: Extension in Chrome/Edge neu laden, dann Service-Worker-Konsole prüfen (Ping/Pong)."

if (-not $ExtensionId) {
    Write-Host ""
    Write-Host "Extension-ID nach dem Laden der Erweiterung nachreichen:"
    Write-Host "  .\scripts\register_native_host.ps1 -ExtensionId <DEINE_32_ZEICHEN_ID>"
}
