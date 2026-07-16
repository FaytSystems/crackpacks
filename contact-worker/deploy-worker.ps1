<#
Full file:
  D:\crackpacks\crackpacks-github-ready\contact-worker\deploy-worker.ps1

Crack Packs Contact Worker deployer v1.7.1.
This source is ASCII-only for Windows PowerShell 5.1.
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

Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found."
}

Invoke-Checked `
    -Command "npx" `
    -Arguments @(
        "wrangler",
        "whoami"
    )

$SecretList = @(
    & npx wrangler secret list --name crackpacks-contact
)

if ($LASTEXITCODE -ne 0) {
    throw "Unable to list Worker secrets."
}

$HasDestination = (
    $SecretList -join "`n"
).Contains("CONTACT_DESTINATION")

if ($SetDestination -or -not $HasDestination) {
    Write-Host ""
    Write-Host "Enter the verified private destination address." -ForegroundColor Yellow
    Write-Host "Use: robertreese@faytsystems.com" -ForegroundColor DarkGray

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
Write-Host "Deploying crackpacks-contact v1.7.1..." -ForegroundColor Cyan

Invoke-Checked `
    -Command "npx" `
    -Arguments @(
        "wrangler",
        "deploy"
    )

Write-Host ""
Write-Host "Waiting for the production health endpoint..." -ForegroundColor Cyan

$HealthUri = "https://contact-api.crackpacks.com/health"
$Health = $null

for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
    try {
        $Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $Health = Invoke-RestMethod `
            -Uri "$HealthUri`?ts=$Timestamp" `
            -Method Get `
            -TimeoutSec 20
        break
    }
    catch {
        Start-Sleep -Seconds 5
    }
}

if (-not $Health) {
    throw "The contact Worker deployed, but the health endpoint could not be reached: $HealthUri"
}

$Health | ConvertTo-Json -Depth 10

if ($Health.configured -ne $true) {
    throw "The contact Worker is reachable but not configured. Review the missing array above."
}

Write-Host ""
Write-Host "Contact Worker is configured." -ForegroundColor Green
