<#
Full file:
  D:\crackpacks\crackpacks-github-ready\contact-worker\deploy-worker.ps1

Deploys the Crack Packs contact Worker.
This source is ASCII-only for Windows PowerShell 5.1 compatibility.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$SetDestination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$Command,

        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    & $Command @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

$WorkerRoot = $PSScriptRoot
Set-Location -LiteralPath $WorkerRoot

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js before deploying the Worker."
}

Invoke-Checked `
    -Command "npx" `
    -Arguments @(
        "wrangler",
        "whoami"
    )

Write-Host ""
Write-Host "Deploying crackpacks-contact..." -ForegroundColor Cyan

Invoke-Checked `
    -Command "npx" `
    -Arguments @(
        "wrangler",
        "deploy"
    )

if ($SetDestination) {
    Write-Host ""
    Write-Host "Enter the verified private destination address." -ForegroundColor Yellow
    Write-Host "For this account, enter: robertreese@faytsystems.com" -ForegroundColor DarkGray
    Write-Host "The value will be stored as the encrypted CONTACT_DESTINATION secret." -ForegroundColor DarkGray

    Invoke-Checked `
        -Command "npx" `
        -Arguments @(
            "wrangler",
            "secret",
            "put",
            "CONTACT_DESTINATION",
            "--name",
            "crackpacks-contact"
        )
}

Write-Host ""
Write-Host "Contact Worker deployment complete." -ForegroundColor Green
Write-Host "Health:  https://contact-api.crackpacks.com/health"
Write-Host "Endpoint: https://contact-api.crackpacks.com/contact"
