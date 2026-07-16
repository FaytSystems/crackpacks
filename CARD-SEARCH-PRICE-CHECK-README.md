# Crack Packs — Card Search & Price Check v1.5.0

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
- Loading skeletons, no-results state, error state, URL state, and pagination
- Responsive desktop and mobile layouts
- Clear estimated-value disclaimer
- API key remains only in the Cloudflare secret `POKEMON_TCG_API_KEY`

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
- `https://crackpacks.com/card-lookup.html`
