[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "BetterFACEIT Installer"

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

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptRoot) { $ScriptRoot = Get-Location }

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
    Write-Failure "FACEIT desktop client is not installed on this system."
    Write-Host "Opening download page in your default browser: https://www.faceit.com/en/client" -ForegroundColor Yellow
    Start-Process "https://www.faceit.com/en/client"
    exit 1
}

$AvailableAppDirs = Get-ChildItem -Path $FaceitBase -Directory -Filter "app-*" | Sort-Object {
    try { [version]($_.Name -replace '^app-', '') } catch { $_.Name }
} -Descending

$TargetAppDir = $AvailableAppDirs[0].FullName
$ResourcesDir = Join-Path $TargetAppDir "resources"
$FaceitExecutable = Join-Path $TargetAppDir "FACEIT.exe"
$AsarArchive = Join-Path $ResourcesDir "app.asar"
$AsarBackupArchive = Join-Path $ResourcesDir "app.asar.backup"

Write-Step "Located FACEIT Client runtime: $TargetAppDir"

if ($AvailableAppDirs.Count -gt 1) {
    for ($i = 1; $i -lt $AvailableAppDirs.Count; $i++) {
        $OldAppDir = $AvailableAppDirs[$i].FullName
        Write-Step "Removing outdated, unusable version: $($AvailableAppDirs[$i].Name)..."
        try {
            Remove-Item -Path $OldAppDir -Recurse -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

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

$AlreadyInstalled = (Test-Path $AsarBackupArchive) -or (Test-Path (Join-Path $ResourcesDir "extensionLoader.js"))

if ($AlreadyInstalled) {
    Write-Host ""
    Write-Host "[!] BetterFACEIT is already installed on this client!" -ForegroundColor Yellow
    $ReinstallPrompt = Read-Host "Do you want to reinstall / update BetterFACEIT to the latest version? [Y/n]"
    if (-not [string]::IsNullOrWhiteSpace($ReinstallPrompt) -and $ReinstallPrompt.Trim().ToLower() -eq 'n') {
        Write-Host "Operation cancelled. Exiting." -ForegroundColor Gray
        exit 0
    }
    Write-Step "Updating BetterFACEIT to the latest version..."
} else {
    Write-Step "Creating verified baseline backup: app.asar.backup"
    Copy-Item $AsarArchive $AsarBackupArchive -Force
}

Write-Step "Installing loader runtime components..."
$SourceComponents = Join-Path $ScriptRoot "src"
Copy-Item (Join-Path $SourceComponents "extensionLoader.js") (Join-Path $ResourcesDir "extensionLoader.js") -Force
Copy-Item (Join-Path $SourceComponents "extensionsManager.html") (Join-Path $ResourcesDir "extensionsManager.html") -Force
Copy-Item (Join-Path $SourceComponents "managerPreload.js") (Join-Path $ResourcesDir "managerPreload.js") -Force
if (Test-Path (Join-Path $SourceComponents "version.json")) {
    Copy-Item (Join-Path $SourceComponents "version.json") (Join-Path $ResourcesDir "version.json") -Force
}

Write-Step "Applying loader hook to app.asar..."
$PatcherModule = Join-Path $ScriptRoot "src\patcher.js"

$env:ELECTRON_RUN_AS_NODE = "1"
$PatchProc = Start-Process -FilePath $FaceitExecutable -ArgumentList "`"$PatcherModule`"", "`"$AsarBackupArchive`"", "`"$AsarArchive`"" -Wait -PassThru -NoNewWindow
$env:ELECTRON_RUN_AS_NODE = $null

if ($PatchProc.ExitCode -ne 0) {
    Write-Failure "Patching failed with exit code $($PatchProc.ExitCode)"
    exit 1
}

$TargetExtensionsDir = Join-Path $FaceitBase "extensions"
if (-not (Test-Path $TargetExtensionsDir)) {
    New-Item -ItemType Directory -Path $TargetExtensionsDir -Force | Out-Null
}

$InstallScriptPath = Join-Path $ScriptRoot "src\Install-Extension.ps1"
Copy-Item $InstallScriptPath (Join-Path $TargetExtensionsDir "Install-Extension.ps1") -Force
if (Test-Path (Join-Path $ScriptRoot "version.json")) {
    Copy-Item (Join-Path $ScriptRoot "version.json") (Join-Path $TargetExtensionsDir "version.json") -Force
}

Write-Step "Deploying bundled extensions..."
$BundledSource = Join-Path $ScriptRoot "extensions"
if (Test-Path $BundledSource) {
    Get-ChildItem -Path $BundledSource -Directory | ForEach-Object {
        $Dest = Join-Path $TargetExtensionsDir $_.Name
        if (-not (Test-Path $Dest)) {
            Copy-Item $_.FullName $Dest -Recurse -Force
        }
    }
}

$ConfigFile = Join-Path $TargetExtensionsDir "config.json"
if (-not (Test-Path $ConfigFile)) {
    $DefaultConfig = @{
        performanceMode = $true
        zoomFactor = 0.95
        disabledExtensions = @("repeek", "cpjienndjbobchlaklajagacpiepclek", "kodlabmmaalpolkfolgpahbjehalecki")
    }
    $DefaultConfig | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
}

Write-Success "BetterFACEIT installation completed successfully."
Write-Host ""
Write-Host "Features & Controls:" -ForegroundColor White
Write-Host "  - Press Ctrl+Shift+E or click 'BETTERFACEIT' in client to open settings" -ForegroundColor Gray
Write-Host "  - Toggle Repeek, Faceit UI Cleaner, and VisusGG on/off in BetterFACEIT" -ForegroundColor Gray
Write-Host "  - In-Client Zoom: use Ctrl+MouseWheel, Ctrl+/-, or the on-screen buttons" -ForegroundColor Gray
Write-Host "  - Low-Resource Mode: active by default (GPU-accelerated, zero background CPU)" -ForegroundColor Gray
Write-Host "  - Press F12 to open DevTools" -ForegroundColor Gray
Write-Host ""

$Prompt = Read-Host "Launch FACEIT Client now? [Y/n]"
if ([string]::IsNullOrWhiteSpace($Prompt) -or $Prompt.Trim().ToLower() -eq 'y') {
    Start-Process (Join-Path $FaceitBase "FACEIT.exe")
}
