[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "BetterFACEIT Uninstaller"

function Write-Step {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Find-FaceitDirectory {
    $Candidates = [System.Collections.Generic.List[string]]::new()
    try {
        $Proc = Get-Process -Name "FACEIT" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Proc -and $Proc.Path) {
            $Candidate = Split-Path -Parent (Split-Path -Parent $Proc.Path)
            if ($Candidate) { $Candidates.Add($Candidate) }
        }
    } catch {}

    if ($env:LOCALAPPDATA) {
        $Candidates.Add((Join-Path $env:LOCALAPPDATA "FACEIT"))
    }

    if ($env:USERPROFILE) {
        $Candidates.Add((Join-Path $env:USERPROFILE "AppData\Local\FACEIT"))
    } elseif ($HOME) {
        $Candidates.Add((Join-Path $HOME "AppData\Local\FACEIT"))
    }

    try {
        $RegKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FACEIT"
        if (Test-Path $RegKey) {
            $Loc = (Get-ItemProperty -Path $RegKey -Name "InstallLocation" -ErrorAction SilentlyContinue).InstallLocation
            if ($Loc) { $Candidates.Add($Loc) }
        }
    } catch {}

    if ($env:ProgramFiles) {
        $Candidates.Add((Join-Path $env:ProgramFiles "FACEIT"))
    }
    if (${env:ProgramFiles(x86)}) {
        $Candidates.Add((Join-Path ${env:ProgramFiles(x86)} "FACEIT"))
    }

    try {
        $UserDirs = Get-ChildItem -Path "C:\Users" -Directory -ErrorAction SilentlyContinue
        foreach ($U in $UserDirs) {
            $Candidates.Add((Join-Path $U.FullName "AppData\Local\FACEIT"))
        }
    } catch {}

    foreach ($P in $Candidates) {
        if ([string]::IsNullOrWhiteSpace($P)) { continue }
        if (Test-Path $P) {
            $Apps = Get-ChildItem -Path $P -Directory -Filter "app-*" -ErrorAction SilentlyContinue
            if ($Apps -and $Apps.Count -gt 0) {
                return $P
            }
        }
    }
    return $null
}

$FaceitBase = Find-FaceitDirectory

if (-not $FaceitBase) {
    Write-Failure "FACEIT desktop client installation was not found."
    exit 1
}

$AvailableAppDirs = Get-ChildItem -Path $FaceitBase -Directory -Filter "app-*" | Sort-Object {
    try { [version]($_.Name -replace '^app-', '') } catch { $_.Name }
} -Descending

$TargetAppDir = $AvailableAppDirs[0].FullName
$ResourcesDir = Join-Path $TargetAppDir "resources"
$AsarArchive = Join-Path $ResourcesDir "app.asar"
$AsarBackupArchive = Join-Path $ResourcesDir "app.asar.backup"

$ActiveInstances = Get-Process -Name "FACEIT" -ErrorAction SilentlyContinue
if ($ActiveInstances) {
    Write-Step "Stopping active FACEIT processes..."
    Stop-Process -Name "FACEIT" -Force -ErrorAction SilentlyContinue
    
    $Retries = 0
    while ((Get-Process -Name "FACEIT" -ErrorAction SilentlyContinue) -and ($Retries -lt 10)) {
        Start-Sleep -Milliseconds 500
        $Retries++
    }
}

if (Test-Path $AsarBackupArchive) {
    Write-Step "Restoring original verified app.asar from backup..."
    Copy-Item $AsarBackupArchive $AsarArchive -Force
    Remove-Item $AsarBackupArchive -Force -ErrorAction SilentlyContinue
    Write-Success "Stock app.asar successfully restored."
} else {
    Write-Host "[!] Baseline backup not found; leaving app.asar intact." -ForegroundColor Yellow
}

Remove-Item (Join-Path $ResourcesDir "extensionLoader.js") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ResourcesDir "extensionsManager.html") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ResourcesDir "managerPreload.js") -Force -ErrorAction SilentlyContinue

Write-Success "Uninstallation completed. Client is restored to stock state."
