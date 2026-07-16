# Crack Packs Contact Form and Email Worker v1.7.0

Repository root:

`D:\crackpacks\crackpacks-github-ready`

## What this adds

- A **Contact Us** button in the footer of every root HTML page.
- A responsive popup contact form with:
  - visitor email;
  - message;
  - Send Message and Cancel buttons;
  - accessible close controls;
  - inline validation and errors.
- A successful-send popup that says:
  - **Please allow up to 48 hours for a reply.**
  - **OK** closes the popup.
- A dedicated Cloudflare Worker at:
  - `https://contact-api.crackpacks.com`
- Cloudflare native email sending from:
  - `support@crackpacks.com`
- The visitor email is used as **Reply-To**, so pressing Reply in the destination inbox addresses the visitor.
- The private destination address is stored as the encrypted Worker secret:
  - `CONTACT_DESTINATION`
- Basic abuse protection:
  - origin allowlist;
  - hidden honeypot;
  - email and message validation;
  - request-size limit;
  - one-minute edge rate limit;
  - no API keys or private destination in browser code.

## Complete files installed

- `D:\crackpacks\crackpacks-github-ready\assets\css\contact-form.css`
- `D:\crackpacks\crackpacks-github-ready\assets\js\contact-form.js`
- `D:\crackpacks\crackpacks-github-ready\contact-worker\src\index.js`
- `D:\crackpacks\crackpacks-github-ready\contact-worker\wrangler.jsonc`
- `D:\crackpacks\crackpacks-github-ready\contact-worker\package.json`
- `D:\crackpacks\crackpacks-github-ready\contact-worker\deploy-worker.ps1`
- `D:\crackpacks\crackpacks-github-ready\CONTACT-FORM-README.md`
- `D:\crackpacks\crackpacks-github-ready\PACKAGE-MANIFEST.json`
- `D:\crackpacks\crackpacks-github-ready\install-crackpacks-contact-form-v1.7.0.ps1`

Every root HTML file in the repository is backed up and then rewritten in full.

## Install, deploy, set destination, and push

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\install-crackpacks-contact-form-v1.7.0.ps1 `
  -RepoRoot "D:\crackpacks\crackpacks-github-ready" `
  -DeployWorker `
  -SetDestination `
  -Push
```

When Wrangler prompts for `CONTACT_DESTINATION`, enter the verified Cloudflare Email Routing destination:

```text
robertreese@faytsystems.com
```

Do not enter `support@crackpacks.com` as the secret. That is the public support address and sender identity. The private destination is where Cloudflare delivers contact-form submissions.

## Cloudflare requirements

The following are already in place for Crack Packs:

- Email Routing is enabled for `crackpacks.com`.
- `support@crackpacks.com` is active.
- `robertreese@faytsystems.com` is a verified destination address.

Cloudflare permits Workers to send to verified destination addresses through an email binding. The sender address must belong to a domain onboarded to Cloudflare Email Service.

## Health check

```text
https://contact-api.crackpacks.com/health
```

Expected configured response:

```json
{
  "ok": true,
  "service": "crackpacks-contact",
  "version": "1.7.0",
  "configured": true,
  "contactAddress": "support@crackpacks.com",
  "endpoints": ["/health", "/contact"]
}
```

## Test the website

Open:

```text
https://crackpacks.com
```

Scroll to the footer, select **Contact Us**, enter a reply email and message, then select **Send Message**.

A successful request changes the modal to:

```text
Message sent
Please allow up to 48 hours for a reply.
OK
```

## Direct PowerShell endpoint test

```powershell
$Body = @{
    email = "YOUR_OTHER_EMAIL@example.com"
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

Use an email address different from the private destination when testing.
