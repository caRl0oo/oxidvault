# Shared helpers for native-messaging host manifest (store ID + allowed_origins).
$ErrorActionPreference = "Stop"

function Get-OxidVaultRepoRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Test-OxidVaultExtensionId {
    param([string]$Id)
    return $Id -match '^[a-p]{32}$'
}

function Get-OxidVaultChromeStoreExtensionId {
    $root = Get-OxidVaultRepoRoot
    $idPath = Join-Path $root "browser-extension\chrome-store-extension.id"
    if (-not (Test-Path $idPath)) {
        throw "Chrome Web Store extension ID file not found: $idPath"
    }
    $id = ([System.IO.File]::ReadAllText($idPath)).Trim()
    if (-not (Test-OxidVaultExtensionId $id)) {
        throw "Invalid Chrome Web Store extension ID in $idPath (expected 32 lowercase a-p letters)."
    }
    return $id
}

function Get-OxidVaultNativeMessagingAllowedOrigins {
    param([string]$DevExtensionId)

    $storeId = Get-OxidVaultChromeStoreExtensionId
    $origins = [ordered]@{}
    $origins["chrome-extension://$storeId/"] = $true

    $devId = if ($DevExtensionId) { $DevExtensionId.Trim() } else { $null }
    if ($devId) {
        if (-not (Test-OxidVaultExtensionId $devId)) {
            throw "Dev ExtensionId must be 32 lowercase a-p letters (copy from chrome://extensions)."
        }
        if ($devId -ne $storeId) {
            $origins["chrome-extension://$devId/"] = $true
        }
    }

    return @($origins.Keys)
}

function Render-OxidVaultNativeMessagingWix {
    $root = Get-OxidVaultRepoRoot
    $storeId = Get-OxidVaultChromeStoreExtensionId
    $placeholder = "__CHROME_STORE_EXTENSION_ID__"
    $templatePath = Join-Path $root "src-tauri\wix\native_messaging.wxs.in"
    $wxsPath = Join-Path $root "src-tauri\wix\native_messaging.wxs"
    $installScriptTemplatePath = Join-Path $root "src-tauri\wix\install-native-messaging-host.ps1.in"
    $installScriptPath = Join-Path $root "src-tauri\wix\install-native-messaging-host.ps1"

    if (-not (Test-Path $templatePath)) {
        throw "WiX template not found: $templatePath"
    }
    if (-not (Test-Path $installScriptTemplatePath)) {
        throw "Install script template not found: $installScriptTemplatePath"
    }

    $wixTemplate = [System.IO.File]::ReadAllText($templatePath)

    $scriptTemplate = [System.IO.File]::ReadAllText($installScriptTemplatePath)
    if (-not $scriptTemplate.Contains($placeholder)) {
        throw "Install script template missing placeholder $placeholder"
    }

    $renderedWix = $wixTemplate
    $renderedScript = $scriptTemplate.Replace($placeholder, $storeId)

    $existingWix = if (Test-Path $wxsPath) { [System.IO.File]::ReadAllText($wxsPath) } else { "" }
    if ($existingWix -ne $renderedWix) {
        [System.IO.File]::WriteAllText($wxsPath, $renderedWix, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Rendered $wxsPath from chrome-store-extension.id"
    }

    $existingScript = if (Test-Path $installScriptPath) { [System.IO.File]::ReadAllText($installScriptPath) } else { "" }
    if ($existingScript -ne $renderedScript) {
        [System.IO.File]::WriteAllText($installScriptPath, $renderedScript, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Rendered $installScriptPath from chrome-store-extension.id"
    }
}
