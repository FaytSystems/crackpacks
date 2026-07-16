# D:\crackpacks\crackpacks-github-ready\youtube-live-worker\deploy-worker.ps1

[CmdletBinding()]
param(
    [switch]$SetSecrets,
    [switch]$OpenDashboard
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WorkerRoot = $PSScriptRoot

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command was not found: $Name"
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

Assert-Command -Name "npm"
Assert-Command -Name "npx"

Push-Location $WorkerRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $WorkerRoot "node_modules") -PathType Container)) {
        Write-Host "Installing Worker dependencies..." -ForegroundColor Cyan
        Invoke-Checked -Command "npm" -Arguments @("install")
    }

    Write-Host "Running JavaScript syntax validation..." -ForegroundColor Cyan
    Invoke-Checked -Command "npm" -Arguments @("run", "check")

    Write-Host "Deploying crackpacks-youtube-live..." -ForegroundColor Cyan
    Invoke-Checked -Command "npx" -Arguments @("wrangler", "deploy")

    if ($SetSecrets) {
        Write-Host "" 
        Write-Host "Wrangler will prompt for the YouTube Data API key." -ForegroundColor Yellow
        Invoke-Checked -Command "npx" -Arguments @("wrangler", "secret", "put", "YOUTUBE_API_KEY")

        Write-Host "" 
        Write-Host "Wrangler will prompt for the Crack Packs YouTube channel ID." -ForegroundColor Yellow
        Invoke-Checked -Command "npx" -Arguments @("wrangler", "secret", "put", "YOUTUBE_CHANNEL_ID")

        Write-Host "Redeploying after secret configuration..." -ForegroundColor Cyan
        Invoke-Checked -Command "npx" -Arguments @("wrangler", "deploy")
    }

    Write-Host "" 
    Write-Host "Cloudflare Worker deployment completed." -ForegroundColor Green
    Write-Host "Add custom domain: live-api.crackpacks.com" -ForegroundColor Yellow
    Write-Host "Health endpoint: https://live-api.crackpacks.com/health"
    Write-Host "Status endpoint: https://live-api.crackpacks.com/status"

    if ($OpenDashboard) {
        Start-Process "https://dash.cloudflare.com/"
    }
}
finally {
    Pop-Location
}
