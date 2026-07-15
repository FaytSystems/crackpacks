[CmdletBinding()]
param(
    [switch]$SetSecret
)

$ErrorActionPreference = "Stop"
$WorkerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $WorkerRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install the current Node.js LTS release, then run this script again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Reinstall Node.js with npm included."
}

Write-Host "Installing Cloudflare Wrangler..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Checking Cloudflare login..." -ForegroundColor Cyan
npx wrangler whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "Opening Cloudflare login..." -ForegroundColor Yellow
    npx wrangler login
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed." }
}

Write-Host "Deploying the Worker code..." -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Worker deployment failed." }

if ($SetSecret) {
    Write-Host "Enter the Pokémon TCG API key when prompted." -ForegroundColor Yellow
    npx wrangler secret put POKEMON_TCG_API_KEY
    if ($LASTEXITCODE -ne 0) { throw "Secret creation failed." }
}

Write-Host "Worker deployment complete." -ForegroundColor Green
Write-Host "Add api.crackpacks.com as a Custom Domain in the Worker dashboard, then test:" -ForegroundColor Green
Write-Host "https://api.crackpacks.com/health"
