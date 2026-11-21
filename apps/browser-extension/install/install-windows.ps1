# Register the Acuye Pass native messaging host for Chrome/Chromium on Windows.
#
# Usage:
#   .\install-windows.ps1 -ExtensionId <id> [-HostPath <path to acuye-browser-host.exe>]
#
# Load the extension with "Load unpacked" and copy its ID from chrome://extensions.
# The native host registry key is written under HKCU, so no administrator rights
# are needed.

param(
    [Parameter(Mandatory = $true)][string]$ExtensionId,
    [string]$HostPath = ""
)

$ErrorActionPreference = "Stop"
$HostName = "com.fluxenite.acuyepass"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $Here "../../..")

if ([string]::IsNullOrWhiteSpace($HostPath)) {
    $HostPath = Join-Path $RepoRoot "target/release/acuye-browser-host.exe"
}

if (-not (Test-Path $HostPath)) {
    throw "The host binary is missing: $HostPath. Build it with: cargo build --release -p acuye-browser-host"
}

$targetDir = Join-Path $env:APPDATA "AcuyePass\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$manifest = [ordered]@{
    name            = $HostName
    description     = "Acuye Pass native messaging host"
    path            = (Resolve-Path $HostPath).Path
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifestPath = Join-Path $targetDir "$HostName.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

$registryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Path $registryKey -Force | Out-Null
Set-ItemProperty -Path $registryKey -Name "(Default)" -Value $manifestPath

Write-Host "Installed $manifestPath"
Write-Host "Host: $($manifest.path)"
Write-Host "Reload the extension, then open its popup."
