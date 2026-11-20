<#
.SYNOPSIS
    Install the WeRead reading-notes plugin (two modes: ask and organise) into a DSH profile.
.DESCRIPTION
    Installs dsh/packages/dsh-weread-kb into the DSH profile (default: dadventures) and writes this repository's
    path into that profile's own cordis.patch.yml, so both modes read the notes of this checkout.
    Rerun it after changing the package: DSH installs a copy. Restart DSH Web afterwards.
    This file is ASCII only on purpose: Windows PowerShell 5 reads a script without a BOM in the system code page.
.PARAMETER ProfileName
    DSH profile to install into. Use an existing one (for example kids-ai-lab) to add the two modes beside its others.
.PARAMETER ModelsFrom
    Another profile whose model provider rows (llm-pi-ai, agent-default-model) are copied when this profile has
    none. A new profile has no model configured; without this you set the model up in DSH Web yourself.
#>
param(
    [string]$ProfileName = "dadventures",
    [string]$ModelsFrom = ""
)

$ErrorActionPreference = "Stop"
$DSH_VERSION = "0.2.0-rc.2"
$REPO_ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PLUGIN_DIR = Join-Path $REPO_ROOT "dsh\packages\dsh-weread-kb"
$HOME_DIR = $env:USERPROFILE
$DSH_HOME_DIR = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path $HOME_DIR ".dsh"
} elseif ($env:DSH_HOME -eq "~") {
    $HOME_DIR
} elseif ($env:DSH_HOME.StartsWith("~/") -or $env:DSH_HOME.StartsWith("~\")) {
    Join-Path $HOME_DIR $env:DSH_HOME.Substring(2)
} else {
    $env:DSH_HOME
}
$DSH_HOME_DIR = [System.IO.Path]::GetFullPath($DSH_HOME_DIR)
$PROFILE_DIR = Join-Path $DSH_HOME_DIR "profiles\$ProfileName"

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js LTS (>= 24) is required."
}
if ([int]((node --version).TrimStart("v").Split(".")[0]) -lt 24) {
    throw "Node.js >= 24 is required."
}
if (!(Get-Command dsh -ErrorAction SilentlyContinue)) {
    throw "DeepSeek Harness is not installed. Install it first: npm install -g @deepseek-ai/dsh@$DSH_VERSION"
}
if ((dsh --version).Trim() -ne $DSH_VERSION) {
    throw "The plugin is tested with DSH $DSH_VERSION; the existing DSH installation was not changed."
}
if (![string]::IsNullOrWhiteSpace($ModelsFrom) -and !(Test-Path (Join-Path $DSH_HOME_DIR "profiles\$ModelsFrom\cordis.patch.yml"))) {
    throw "Profile $ModelsFrom (for -ModelsFrom) has no cordis.patch.yml under $DSH_HOME_DIR\profiles."
}

$created = $false
if (!(Test-Path (Join-Path $PROFILE_DIR "package.json"))) {
    dsh --profile $ProfileName --from-default-profile web --dump-config | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Initializing the DSH Web profile $ProfileName failed."
    }
    $created = $true
}

dsh plugin --profile $ProfileName add --force "file:$($PLUGIN_DIR -replace '\\', '/')"
if ($LASTEXITCODE -ne 0) {
    throw "Installing $PLUGIN_DIR into the DSH profile failed."
}

$configArgs = @((Join-Path $PSScriptRoot "profile-config.js"), $PROFILE_DIR, $REPO_ROOT)
if ($created) { $configArgs += "--select-default" }
if (![string]::IsNullOrWhiteSpace($ModelsFrom)) { $configArgs += @("--models-from", (Join-Path $DSH_HOME_DIR "profiles\$ModelsFrom")) }
$written = node @configArgs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw "Writing the repository path into $PROFILE_DIR\cordis.patch.yml failed."
}

$dump = (dsh --profile $ProfileName --dump-config) -join "`n"
if ($LASTEXITCODE -ne 0) {
    throw "The profile $ProfileName does not compose; check $PROFILE_DIR\cordis.patch.yml."
}
foreach ($row in @("weread-kb", "preset-wereadask", "preset-wereadkb")) {
    if ($dump -notmatch $row) {
        throw "The profile $ProfileName does not compose $row; check $PROFILE_DIR\cordis.patch.yml."
    }
}

Write-Host "Installed from: $PLUGIN_DIR" -ForegroundColor Green
Write-Host "Profile:        $PROFILE_DIR" -ForegroundColor Green
Write-Host "Reading notes:  $($written.repoRoot)" -ForegroundColor Green
if ($written.copied.Count -gt 0) {
    Write-Host "Model rows copied from $ModelsFrom`: $($written.copied -join ', ')" -ForegroundColor Green
} elseif ($created) {
    Write-Host "This new profile has no model yet: set it up in DSH Web, or rerun with -ModelsFrom <profile>." -ForegroundColor Yellow
}
Write-Host "Two modes were added: wereadask (ask the notes, read-only) and wereadkb (organise notes into cards)." -ForegroundColor Yellow
Write-Host "For the organise mode, open the session in $REPO_ROOT so the file tools can write cards." -ForegroundColor Yellow
Write-Host "Restart DSH Web, then pick a mode in a new session. Start it with:" -ForegroundColor Yellow
Write-Host "  dsh --profile $ProfileName --port 3091" -ForegroundColor White
