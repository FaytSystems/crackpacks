<#
Full file:
  D:\crackpacks\crackpacks-github-ready\install-crackpacks-contact-form-v1.7.1.ps1

Crack Packs Contact Form hotfix v1.7.1.
Rewrites complete contact files and every root HTML page.
This source is ASCII-only for Windows PowerShell 5.1.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$RepoRoot = "D:\crackpacks\crackpacks-github-ready",

    [Parameter()]
    [switch]$DeployWorker,

    [Parameter()]
    [switch]$SetDestination,

    [Parameter()]
    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageRoot = $PSScriptRoot
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Read-Utf8File {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return [System.IO.File]::ReadAllText(
        $Path,
        $script:Utf8Strict
    )
}

function Write-Utf8FileAtomic {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Content
    )

    $TemporaryPath = "$Path.contact-v1.7.1.tmp"

    [System.IO.File]::WriteAllText(
        $TemporaryPath,
        $Content,
        $script:Utf8NoBom
    )

    Move-Item `
        -LiteralPath $TemporaryPath `
        -Destination $Path `
        -Force
}

function Remove-GeneratedBlock {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [string]$StartMarker,

        [Parameter(Mandatory)]
        [string]$EndMarker
    )

    while ($true) {
        $StartIndex = $Text.IndexOf(
            $StartMarker,
            [System.StringComparison]::Ordinal
        )

        if ($StartIndex -lt 0) {
            return $Text
        }

        $EndIndex = $Text.IndexOf(
            $EndMarker,
            $StartIndex,
            [System.StringComparison]::Ordinal
        )

        if ($EndIndex -lt 0) {
            throw "Generated block is missing its end marker: $StartMarker"
        }

        $RemoveLength = (
            $EndIndex +
            $EndMarker.Length -
            $StartIndex
        )

        $Text = $Text.Remove(
            $StartIndex,
            $RemoveLength
        )
    }
}

function Insert-BeforeTag {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text,

        [Parameter(Mandatory)]
        [string]$ClosingTag,

        [Parameter(Mandatory)]
        [string]$Block
    )

    $Index = $Text.IndexOf(
        $ClosingTag,
        [System.StringComparison]::OrdinalIgnoreCase
    )

    if ($Index -lt 0) {
        throw "Required closing tag was not found: $ClosingTag"
    }

    return $Text.Insert(
        $Index,
        $Block
    )
}

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

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
    throw "Repository folder not found: $RepoRoot"
}

$ResolvedRepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $ResolvedRepoRoot "analysis\contact_form_backup_$Timestamp"

$PackageFiles = @(
    "assets\css\contact-form.css",
    "assets\js\contact-form.js",
    "contact-worker\src\index.js",
    "contact-worker\wrangler.jsonc",
    "contact-worker\package.json",
    "contact-worker\deploy-worker.ps1",
    "CONTACT-FORM-README.md",
    "PACKAGE-MANIFEST.json",
    "install-crackpacks-contact-form-v1.7.1.ps1"
)

foreach ($RelativePath in $PackageFiles) {
    $SourcePath = Join-Path $PackageRoot $RelativePath

    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        throw "Package file is missing: $SourcePath"
    }
}

$HtmlFiles = @(
    Get-ChildItem `
        -LiteralPath $ResolvedRepoRoot `
        -Filter "*.html" `
        -File |
        Sort-Object Name
)

if ($HtmlFiles.Count -eq 0) {
    throw "No root HTML pages were found."
}

New-Item `
    -ItemType Directory `
    -Path $BackupRoot `
    -Force |
    Out-Null

foreach ($HtmlFile in $HtmlFiles) {
    Copy-Item `
        -LiteralPath $HtmlFile.FullName `
        -Destination (Join-Path $BackupRoot $HtmlFile.Name) `
        -Force
}

foreach ($RelativePath in $PackageFiles) {
    $DestinationPath = Join-Path $ResolvedRepoRoot $RelativePath

    if (Test-Path -LiteralPath $DestinationPath -PathType Leaf) {
        $BackupPath = Join-Path $BackupRoot $RelativePath
        $BackupParent = Split-Path -Parent $BackupPath

        New-Item `
            -ItemType Directory `
            -Path $BackupParent `
            -Force |
            Out-Null

        Copy-Item `
            -LiteralPath $DestinationPath `
            -Destination $BackupPath `
            -Force
    }

    $DestinationParent = Split-Path -Parent $DestinationPath

    New-Item `
        -ItemType Directory `
        -Path $DestinationParent `
        -Force |
        Out-Null

    Copy-Item `
        -LiteralPath (Join-Path $PackageRoot $RelativePath) `
        -Destination $DestinationPath `
        -Force

    Write-Host "Rewrote complete file: $DestinationPath" -ForegroundColor Green
}

$AssetStart = "<!-- CRACK PACKS CONTACT ASSETS:START -->"
$AssetEnd = "<!-- CRACK PACKS CONTACT ASSETS:END -->"
$FooterStart = "<!-- CRACK PACKS CONTACT FOOTER:START -->"
$FooterEnd = "<!-- CRACK PACKS CONTACT FOOTER:END -->"
$ModalStart = "<!-- CRACK PACKS CONTACT MODAL:START -->"
$ModalEnd = "<!-- CRACK PACKS CONTACT MODAL:END -->"
$ScriptStart = "<!-- CRACK PACKS CONTACT SCRIPT:START -->"
$ScriptEnd = "<!-- CRACK PACKS CONTACT SCRIPT:END -->"

$UpdatedHtmlNames = New-Object System.Collections.Generic.List[string]

foreach ($HtmlFile in $HtmlFiles) {
    $Original = Read-Utf8File -Path $HtmlFile.FullName

    if ($Original.Contains("`r`n")) {
        $NewLine = "`r`n"
    }
    else {
        $NewLine = "`n"
    }

    $Updated = $Original

    $Updated = Remove-GeneratedBlock -Text $Updated -StartMarker $AssetStart -EndMarker $AssetEnd
    $Updated = Remove-GeneratedBlock -Text $Updated -StartMarker $FooterStart -EndMarker $FooterEnd
    $Updated = Remove-GeneratedBlock -Text $Updated -StartMarker $ModalStart -EndMarker $ModalEnd
    $Updated = Remove-GeneratedBlock -Text $Updated -StartMarker $ScriptStart -EndMarker $ScriptEnd

    $AssetBlock = (
        "  $AssetStart" + $NewLine +
        "  <link rel=""stylesheet"" href=""assets/css/contact-form.css?v=1.7.1"">" + $NewLine +
        "  $AssetEnd" + $NewLine
    )

    $FooterBlock = (
        "  $FooterStart" + $NewLine +
        "  <div class=""container contact-footer-cta"">" + $NewLine +
        "    <p>Questions about an order, a card, a live break, or Crack Packs?</p>" + $NewLine +
        "    <button class=""contact-open-button"" type=""button"" data-contact-open>Contact Us</button>" + $NewLine +
        "  </div>" + $NewLine +
        "  $FooterEnd" + $NewLine
    )

    $ModalBlock = (
        "$ModalStart" + $NewLine +
        "<div class=""contact-modal"" data-contact-modal hidden aria-hidden=""true"">" + $NewLine +
        "  <button class=""contact-modal-backdrop"" type=""button"" data-contact-close aria-label=""Close contact form""></button>" + $NewLine +
        "  <section class=""contact-modal-card"" role=""dialog"" aria-modal=""true"" aria-labelledby=""contact-modal-title"">" + $NewLine +
        "    <button class=""contact-modal-close"" type=""button"" data-contact-close aria-label=""Close contact form"">&times;</button>" + $NewLine +
        "    <div data-contact-form-panel>" + $NewLine +
        "      <p class=""contact-modal-kicker"">Crack Packs Support</p>" + $NewLine +
        "      <h2 id=""contact-modal-title"">Contact Us</h2>" + $NewLine +
        "      <p class=""contact-modal-intro"">Send a message to support@crackpacks.com. Enter the email address where you want us to reply.</p>" + $NewLine +
        "      <form class=""contact-form"" data-contact-form novalidate>" + $NewLine +
        "        <label class=""contact-field"">" + $NewLine +
        "          <span>Your email</span>" + $NewLine +
        "          <input type=""email"" name=""email"" data-contact-email autocomplete=""email"" inputmode=""email"" maxlength=""254"" required placeholder=""you@example.com"">" + $NewLine +
        "        </label>" + $NewLine +
        "        <label class=""contact-field"">" + $NewLine +
        "          <span>Message</span>" + $NewLine +
        "          <textarea name=""message"" data-contact-message minlength=""10"" maxlength=""4000"" required placeholder=""How can Crack Packs help?""></textarea>" + $NewLine +
        "        </label>" + $NewLine +
        "        <label class=""contact-honeypot"" hidden aria-hidden=""true"">" + $NewLine +
        "          <span>Company</span>" + $NewLine +
        "          <input type=""text"" name=""company"" tabindex=""-1"" autocomplete=""off"">" + $NewLine +
        "        </label>" + $NewLine +
        "        <p class=""contact-form-status"" data-contact-status aria-live=""polite""></p>" + $NewLine +
        "        <div class=""contact-form-actions"">" + $NewLine +
        "          <button class=""contact-submit"" type=""submit"" data-contact-submit>Send Message</button>" + $NewLine +
        "          <button class=""contact-cancel"" type=""button"" data-contact-close>Cancel</button>" + $NewLine +
        "        </div>" + $NewLine +
        "      </form>" + $NewLine +
        "    </div>" + $NewLine +
        "    <div class=""contact-success"" data-contact-success hidden>" + $NewLine +
        "      <div class=""contact-success-icon"" aria-hidden=""true"">&#10003;</div>" + $NewLine +
        "      <h2>Message sent</h2>" + $NewLine +
        "      <p>Please allow up to 48 hours for a reply.</p>" + $NewLine +
        "      <button class=""contact-success-ok"" type=""button"" data-contact-success-ok>OK</button>" + $NewLine +
        "    </div>" + $NewLine +
        "  </section>" + $NewLine +
        "</div>" + $NewLine +
        "$ModalEnd" + $NewLine
    )

    $ScriptBlock = (
        "$ScriptStart" + $NewLine +
        "<script src=""assets/js/contact-form.js?v=1.7.1""></script>" + $NewLine +
        "$ScriptEnd" + $NewLine
    )

    $Updated = Insert-BeforeTag -Text $Updated -ClosingTag "</head>" -Block $AssetBlock
    $Updated = Insert-BeforeTag -Text $Updated -ClosingTag "</footer>" -Block $FooterBlock
    $Updated = Insert-BeforeTag -Text $Updated -ClosingTag "</body>" -Block ($ModalBlock + $ScriptBlock)

    $Checks = @(
        "assets/css/contact-form.css?v=1.7.1",
        "data-contact-open",
        "class=""contact-honeypot"" hidden",
        "Please allow up to 48 hours for a reply.",
        "assets/js/contact-form.js?v=1.7.1"
    )

    foreach ($Check in $Checks) {
        if (-not $Updated.Contains($Check)) {
            throw "HTML verification failed in $($HtmlFile.FullName): $Check"
        }
    }

    Write-Utf8FileAtomic `
        -Path $HtmlFile.FullName `
        -Content $Updated

    $UpdatedHtmlNames.Add($HtmlFile.Name)
    Write-Host "Rewrote complete page: $($HtmlFile.FullName)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Backup folder: $BackupRoot" -ForegroundColor Cyan

if ($DeployWorker -or $SetDestination) {
    $DeployScript = Join-Path $ResolvedRepoRoot "contact-worker\deploy-worker.ps1"

    if ($SetDestination) {
        & $DeployScript -SetDestination
    }
    else {
        & $DeployScript
    }
}

if ($Push) {
    Set-Location -LiteralPath $ResolvedRepoRoot

    $GitPaths = @()
    $GitPaths += @($UpdatedHtmlNames)
    $GitPaths += @(
        "assets/css/contact-form.css",
        "assets/js/contact-form.js",
        "contact-worker",
        "CONTACT-FORM-README.md",
        "PACKAGE-MANIFEST.json",
        "install-crackpacks-contact-form-v1.7.1.ps1"
    )

    Invoke-Checked `
        -Command "git" `
        -Arguments (@("add", "--") + $GitPaths)

    $PendingChanges = @(
        & git diff --cached --name-only
    )

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect staged Git changes."
    }

    if ($PendingChanges.Count -gt 0) {
        Invoke-Checked `
            -Command "git" `
            -Arguments @(
                "commit",
                "-m",
                "Fix Contact Us styling and email diagnostics"
            )

        Invoke-Checked `
            -Command "git" `
            -Arguments @(
                "push",
                "origin",
                "HEAD"
            )
    }
    else {
        Write-Host "No Git changes were staged." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Contact form hotfix v1.7.1 complete." -ForegroundColor Green
Write-Host "Health: https://contact-api.crackpacks.com/health"
Write-Host "Site:   https://crackpacks.com"
