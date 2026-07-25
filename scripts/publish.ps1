# Manual publish script for Windows / PowerShell
# Usage:
#   $env:VSCE_PAT = "<azure-devops-pat>"
#   $env:OVSX_PAT = "<open-vsx-token>"
#   .\scripts\publish.ps1 [-DryRun]
#
# See docs/PUBLISHING.md for the full publisher setup procedure.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipTests,
    [string]$VsixOutput = $null
)

$ErrorActionPreference = 'Stop'

# --- Preconditions -----------------------------------------------------------

if (-not $DryRun -and -not $env:VSCE_PAT) {
    Write-Error "VSCE_PAT environment variable is not set. Run: `$env:VSCE_PAT = '<token>'"
    exit 1
}

if (-not $DryRun -and -not $env:OVSX_PAT) {
    Write-Warning "OVSX_PAT is not set. Skipping Open VSX publish."
}

# --- Detect version ----------------------------------------------------------

$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$version = $packageJson.version
$name = $packageJson.name
Write-Host "`n== Publishing $name@$version ==" -ForegroundColor Cyan

if (-not $VsixOutput) {
    $VsixOutput = "$name-$version.vsix"
}

# --- Build ------------------------------------------------------------------

Write-Host "`n[1/5] Installing dependencies..." -ForegroundColor Yellow
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "`n[2/5] Type-checking..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) { throw "tsc failed" }

if (-not $SkipTests) {
    Write-Host "`n[3/5] Running tests..." -ForegroundColor Yellow
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
} else {
    Write-Host "`n[3/5] Tests skipped (-SkipTests)" -ForegroundColor DarkYellow
}

Write-Host "`n[4/5] Packaging VSIX..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }

npx @vscode/vsce package --no-dependencies -o $VsixOutput
if ($LASTEXITCODE -ne 0) { throw "vsce package failed" }

Write-Host "`nVSIX created: $VsixOutput" -ForegroundColor Green
Get-ChildItem $VsixOutput | Format-Table Name, Length, LastWriteTime

# --- Publish -----------------------------------------------------------------

if ($DryRun) {
    Write-Host "`n[5/5] Dry-run: skipping publish steps." -ForegroundColor DarkYellow
    Write-Host "`nVSIX available at: $VsixOutput" -ForegroundColor Green
    exit 0
}

Write-Host "`n[5/5] Publishing..." -ForegroundColor Yellow

Write-Host "`n>>> VS Code Marketplace" -ForegroundColor Cyan
npx @vscode/vsce publish --packagePath $VsixOutput -p $env:VSCE_PAT
if ($LASTEXITCODE -ne 0) { throw "vsce publish failed" }

if ($env:OVSX_PAT) {
    Write-Host "`n>>> Open VSX" -ForegroundColor Cyan
    npx ovsx publish $VsixOutput -p $env:OVSX_PAT
    if ($LASTEXITCODE -ne 0) { throw "ovsx publish failed" }
}

Write-Host "`n=== Published successfully ===" -ForegroundColor Green
Write-Host "VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=$($packageJson.publisher).$name" -ForegroundColor Green
Write-Host "Open VSX:            https://open-vsx.org/extension/$($packageJson.publisher)/$name" -ForegroundColor Green
