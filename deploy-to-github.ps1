$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/FaytSystems/crackpacks.git'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location $RepoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is not installed or is not available in PATH.'
}

if (-not (Test-Path '.git')) {
    git init
}

git branch -M main

$ExistingRemote = git remote 2>$null | Where-Object { $_ -eq 'origin' }
if ($ExistingRemote) {
    git remote set-url origin $RepoUrl
} else {
    git remote add origin $RepoUrl
}

git add --all

git diff --cached --quiet
$HasChanges = $LASTEXITCODE -ne 0
if ($HasChanges) {
    git commit -m 'Launch vibrant Crack Packs storefront'
} else {
    Write-Host 'No new changes to commit.' -ForegroundColor Yellow
}

git push -u origin main

Write-Host ''
Write-Host 'Push complete. Open GitHub Settings > Pages and select GitHub Actions.' -ForegroundColor Green
Write-Host 'Repository: https://github.com/FaytSystems/crackpacks' -ForegroundColor Cyan
