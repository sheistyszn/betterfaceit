[CmdletBinding()]
param(
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$ExtensionIdOrUrl = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$LocalAppPath = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
$ExtensionsDir = Join-Path $LocalAppPath "FACEIT\extensions"

if (-not (Test-Path $ExtensionsDir)) {
    New-Item -ItemType Directory -Path $ExtensionsDir -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($ExtensionIdOrUrl)) {
    Write-Host "FACEIT Extension Installer" -ForegroundColor Cyan
    $ExtensionIdOrUrl = Read-Host "Enter Chrome Web Store Extension URL or Extension ID"
}

if ([string]::IsNullOrWhiteSpace($ExtensionIdOrUrl)) {
    exit 1
}

$ExtensionId = $ExtensionIdOrUrl
if ($ExtensionIdOrUrl -match "([a-p]{32})") {
    $ExtensionId = $matches[1]
}

$DownloadUri = "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.6099.130&acceptformat=crx2,crx3&x=id%3D$ExtensionId%26uc"
$TempArchive = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString() + ".bin")
$TempZip = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString() + ".zip")

try {
    Invoke-WebRequest -Uri $DownloadUri -OutFile $TempArchive -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -UseBasicParsing

    $RawBytes = [System.IO.File]::ReadAllBytes($TempArchive)
    $PayloadOffset = 0

    if ($RawBytes.Length -ge 16 -and $RawBytes[0] -eq 0x43 -and $RawBytes[1] -eq 0x72 -and $RawBytes[2] -eq 0x32 -and $RawBytes[3] -eq 0x34) {
        $Version = [System.BitConverter]::ToUInt32($RawBytes, 4)
        if ($Version -eq 3) {
            $PayloadOffset = 12 + [System.BitConverter]::ToUInt32($RawBytes, 8)
        } elseif ($Version -eq 2) {
            $KeyLen = [System.BitConverter]::ToUInt32($RawBytes, 8)
            $SigLen = [System.BitConverter]::ToUInt32($RawBytes, 12)
            $PayloadOffset = 16 + $KeyLen + $SigLen
        }
    }

    if ($PayloadOffset -gt 0 -and $PayloadOffset -lt $RawBytes.Length) {
        $ZipLength = $RawBytes.Length - $PayloadOffset
        $ZipBytes = New-Object byte[] $ZipLength
        [System.Array]::Copy($RawBytes, $PayloadOffset, $ZipBytes, 0, $ZipLength)
        [System.IO.File]::WriteAllBytes($TempZip, $ZipBytes)
    } else {
        Copy-Item $TempArchive $TempZip -Force
    }

    $Destination = Join-Path $ExtensionsDir $ExtensionId
    if (Test-Path $Destination) {
        Remove-Item $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    Expand-Archive -Path $TempZip -DestinationPath $Destination -Force

    $ReservedMeta = Join-Path $Destination "_metadata"
    if (Test-Path $ReservedMeta) {
        Remove-Item $ReservedMeta -Recurse -Force
    }

    Get-ChildItem -Path $Destination -Recurse -Filter "*.js" | ForEach-Object {
        $Text = [System.IO.File]::ReadAllText($_.FullName)
        if ($Text.Contains('storageType:o="sync"') -or $Text.Contains('storageType:a="sync"') -or $Text.Contains('storageType:n="sync"')) {
            $Text = $Text.Replace('storageType:o="sync"', 'storageType:o="local"').Replace('storageType:a="sync"', 'storageType:a="local"').Replace('storageType:n="sync"', 'storageType:n="local"')
            [System.IO.File]::WriteAllText($_.FullName, $Text)
        }
    }

    $OptHtml = Join-Path $Destination "options\index.html"
    $PopHtml = Join-Path $Destination "popup\index.html"
    if ((Test-Path $OptHtml) -and (Test-Path $PopHtml)) {
        Set-Content -Path $OptHtml -Value '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Settings</title><script>window.location.replace("../popup/index.html");</script></head><body style="background:#121316;color:#fff;"></body></html>'
    }

    $ManifestFile = Join-Path $Destination "manifest.json"
    $ExtensionName = $ExtensionId
    if (Test-Path $ManifestFile) {
        try {
            $Parsed = Get-Content $ManifestFile -Raw | ConvertFrom-Json
            if ($Parsed.name -and -not $Parsed.name.StartsWith("__MSG_")) {
                $ExtensionName = $Parsed.name
            }
        } catch {}
    }

    Write-Host "Successfully installed '$ExtensionName'" -ForegroundColor Green
} finally {
    Remove-Item $TempArchive, $TempZip -Force -ErrorAction SilentlyContinue
}
