# OxidVault — Dev-Start mit korrektem Rust/MSVC-PATH (Windows)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

if (Test-Path $cargoBin) {
    $env:Path = "$cargoBin;$env:Path"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo nicht gefunden. Installiere Rust: winget install Rustlang.Rustup"
    exit 1
}

# MSVC linker (link.exe) für Tauri/Rust auf Windows
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsPath) {
            $vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path $vcvars) {
                Write-Host "MSVC-Umgebung wird geladen..."
                cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
                    if ($_ -match "^([^=]+)=(.*)$") {
                        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
                    }
                }
            }
        }
    }
}

if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    Write-Error @"
MSVC Linker (link.exe) nicht gefunden.
Installiere Visual Studio Build Tools mit C++:
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
"@
    exit 1
}

Set-Location $root

node (Join-Path $root "scripts\sync-version.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Starte OxidVault (tauri dev)..."
npx tauri dev
