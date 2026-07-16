# Crack Packs Contact Form Hotfix v1.7.1

This replaces v1.7.0.

## Fixes

- The hidden anti-spam `Company` input now has the native HTML `hidden` attribute.
- The CSS also force-hides the field.
- The browser displays a specific reference code when Cloudflare rejects an email.
- The Worker health response identifies whether the email binding or destination secret is missing.
- The Worker accepts:
  - `https://crackpacks.com`
  - `https://www.crackpacks.com`
  - `https://crackpacks.pages.dev`
  - Cloudflare Pages preview subdomains ending in `.crackpacks.pages.dev`
  - the configured localhost development origins.
- The production Wrangler configuration no longer uses the local-development-only `remote` setting.
- `CONTACT_DESTINATION` is declared as a required secret.
- Worker deployment verifies the production health endpoint before completing.

## Install

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\install-crackpacks-contact-form-v1.7.1.ps1 `
  -RepoRoot "D:\crackpacks\crackpacks-github-ready" `
  -DeployWorker `
  -SetDestination `
  -Push
```

When prompted for `CONTACT_DESTINATION`, enter:

```text
robertreese@faytsystems.com
```

## Health check

```text
https://contact-api.crackpacks.com/health
```

Expected:

```json
{
  "ok": true,
  "service": "crackpacks-contact",
  "version": "1.7.1",
  "configured": true,
  "bindingConfigured": true,
  "destinationConfigured": true,
  "missing": []
}
```

## Direct test

```powershell
$Body = @{
    email = "another-address@example.com"
    message = "This is a Crack Packs contact form test message."
    company = ""
    page = "https://crackpacks.com"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "https://contact-api.crackpacks.com/contact" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{
        Origin = "https://crackpacks.com"
    } `
    -Body $Body |
    ConvertTo-Json -Depth 10
```
