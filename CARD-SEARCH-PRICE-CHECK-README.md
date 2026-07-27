# Crack Packs - Card Search & Price Check v1.8.0

Repository root:

`D:\crackpacks\crackpacks-github-ready`

## Full replacement and new files

- `D:\crackpacks\crackpacks-github-ready\index.html`
- `D:\crackpacks\crackpacks-github-ready\shop.html`
- `D:\crackpacks\crackpacks-github-ready\releases.html`
- `D:\crackpacks\crackpacks-github-ready\404.html`
- `D:\crackpacks\crackpacks-github-ready\card-lookup.html`
- `D:\crackpacks\crackpacks-github-ready\assets\css\card-lookup.css`
- `D:\crackpacks\crackpacks-github-ready\assets\js\config.js`
- `D:\crackpacks\crackpacks-github-ready\assets\js\card-lookup.js`
- `D:\crackpacks\crackpacks-github-ready\cloudflare-worker\src\index.js`
- `D:\crackpacks\crackpacks-github-ready\CARD-SEARCH-PRICE-CHECK-README.md`

The existing base files remain in place and are not partially patched:

- `assets\css\styles.css`
- `assets\js\app.js`
- `assets\js\data.js`

The new dedicated page loads the existing site system and then adds its own complete page-specific CSS and JavaScript.

## Features

- Prominent **Card Search & Price Check** main-navigation item
- Search by all fields, card/Pokémon name, set, card number, rarity, or type/subtype
- Card artwork, set, number, rarity, types/subtypes, and artist
- TCGplayer market, low, mid, and direct-low references when returned
- Cardmarket fallback reference when returned
- External market-verification link
- Live eBay Browse API active listings with current asking price, image, condition, shipping, and direct listing link
- Server-side eBay OAuth token minting and reuse; no eBay credential is exposed to the browser
- Loading skeletons, no-results state, error state, URL state, and pagination
- Responsive desktop and mobile layouts
- Clear estimated-value disclaimer
- API keys remain only in Cloudflare Worker secrets

## eBay Browse API setup

Create Production application credentials at:

- `https://developer.ebay.com/my/keys`

Use the Production values and enter them interactively. Do not put either value in `wrangler.jsonc`, `.dev.vars.example`, frontend JavaScript, Git, or chat.

```powershell
Set-Location "C:\Users\UrsaMajor\OneDrive\Desktop\PROJECT\crackpacks-origin-main\cloudflare-worker"
npx.cmd wrangler secret put EBAY_CLIENT_ID
npx.cmd wrangler secret put EBAY_CLIENT_SECRET
npx.cmd wrangler secret list
npm.cmd test
npx.cmd wrangler deploy
```

`EBAY_CLIENT_ID` is the eBay App ID / Client ID. `EBAY_CLIENT_SECRET` is the Cert ID / Client Secret. The Worker creates the short-lived application access token, so do not create an `EBAY_ACCESS_TOKEN` secret.

The live Worker is configured for Production and `EBAY_US`. Use Sandbox credentials only with local `.dev.vars` and change the local `EBAY_ENVIRONMENT` to `sandbox`.

The Browse API returns active listings and asking prices. It does not return verified completed-sale history. The UI labels these rows as active listings and keeps manual sold-price source links separate.

## Install, optionally deploy the Worker, commit, and push

From the extracted package folder:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\install-crackpacks-card-search-price-check-v1.5.0.ps1 `
  -RepoRoot "D:\crackpacks\crackpacks-github-ready" `
  -DeployWorker `
  -Push
```

Omit `-DeployWorker` to install only the website files.

Omit `-Push` to install and validate locally without committing or pushing.

## Local preview

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready"
python -m http.server 8080
```

Open:

- `http://localhost:8080/card-lookup.html`
- `http://localhost:8080/card-lookup.html?q=charizard&field=name`

## Live validation after Cloudflare deployment

- `https://api.crackpacks.com/health`
- `https://api.crackpacks.com/cards?term=charizard&field=name&page=1&pageSize=20`
- `https://api.crackpacks.com/ebay?term=charizard%20pokemon%20card&page=1&pageSize=6`
- `https://crackpacks.com/card-lookup.html`
