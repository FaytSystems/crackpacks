# CrackPacks.com

Static storefront, release radar, and secure Pokémon card-catalog search for **Crack Packs**.

Repository: `FaytSystems/crackpacks`

## Architecture

- GitHub Pages serves the storefront.
- The browser calls `https://api.crackpacks.com/cards`.
- A Cloudflare Worker receives the search request.
- The Worker reads the encrypted Cloudflare secret named `POKEMON_TCG_API_KEY`.
- The Worker sends that secret to Pokémon TCG API in the `X-Api-Key` header.
- The API key is never stored in the public GitHub repository or browser JavaScript.

## Included

- `index.html` — homepage
- `shop.html` — inventory plus live card-catalog search
- `releases.html` — release calendar with live countdowns
- `404.html` — custom error page
- `assets/css/styles.css` — complete responsive visual system
- `assets/js/config.js` — Whatnot URL, public Worker endpoint, email, and site settings
- `assets/js/data.js` — store inventory and release data
- `assets/js/app.js` — storefront rendering, filtering, catalog search, slideshows, and navigation
- `cloudflare-worker/src/index.js` — secure Pokémon TCG API proxy
- `cloudflare-worker/wrangler.jsonc` — Worker configuration and allowed public origins
- `cloudflare-worker/package.json` — Worker development commands
- `cloudflare-worker/deploy-worker.ps1` — PowerShell deployment helper
- `.github/workflows/pages.yml` — GitHub Pages deployment
- `deploy-to-github.ps1` — site repository deployment helper

## Cloudflare secret

Create exactly this secret name:

```text
POKEMON_TCG_API_KEY
```

The Worker accesses it with:

```js
env.POKEMON_TCG_API_KEY
```

Never add the API key to `wrangler.jsonc`, `config.js`, a GitHub secret that is copied into the static site, or any committed `.env` file.

## Deploy the Cloudflare Worker

From PowerShell:

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready\cloudflare-worker"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\deploy-worker.ps1 -SetSecret
```

When Wrangler prompts for the secret value, paste only the Pokémon TCG API key and press Enter.

The equivalent manual commands are:

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready\cloudflare-worker"
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put POKEMON_TCG_API_KEY
```

## Cloudflare Dashboard alternative

1. Open **Cloudflare Dashboard → Workers & Pages**.
2. Open the Worker named **crackpacks-card-search**.
3. Open **Settings → Variables and Secrets**.
4. Add a new encrypted secret.
5. Name it `POKEMON_TCG_API_KEY`.
6. Paste the API key as the value and save.
7. Redeploy the Worker if Cloudflare requests it.

## Add the API custom domain

In the Worker dashboard:

1. Open **Settings → Domains & Routes**.
2. Add the Custom Domain `api.crackpacks.com`.
3. Wait for Cloudflare to activate the hostname.
4. Open `https://api.crackpacks.com/health`.

Expected response:

```json
{
  "ok": true,
  "service": "crackpacks-card-search",
  "apiKeyConfigured": true
}
```

The storefront already uses this endpoint in:

`assets/js/config.js`

```js
cardApiUrl: "https://api.crackpacks.com/cards"
```

If you use the generated `workers.dev` URL instead, replace `cardApiUrl` with that URL plus `/cards`.

## Local Worker development

Copy the example secret file without committing it:

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready\cloudflare-worker"
Copy-Item ".dev.vars.example" ".dev.vars"
notepad ".dev.vars"
```

Place the API key after the equals sign:

```text
POKEMON_TCG_API_KEY=YOUR_REAL_KEY
```

Then run:

```powershell
npm install
npm run dev
```

`.dev.vars` is ignored by Git.

## Push the updated website to GitHub

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready"
git add .
git commit -m "Add secure Pokémon card database search"
git push origin main
```

## Required storefront edits

### Whatnot profile

Open `assets/js/config.js` and replace:

```js
whatnotUrl: "https://www.whatnot.com/user/YOUR_USERNAME"
```

Also replace every `YOUR_USERNAME` placeholder in `assets/js/data.js`.

### Store inventory

Open `assets/js/data.js` and update each product's name, price, stock, description, image, and checkout URL.

### Product images

Use photos taken by Crack Packs, distributor-authorized assets, or images with a valid license. The live catalog uses images returned by Pokémon TCG API; continue to comply with the API's terms and attribution requirements.

## Test URLs

Worker health:

```text
https://api.crackpacks.com/health
```

Example card search:

```text
https://api.crackpacks.com/cards?term=charizard&page=1&pageSize=24&orderBy=-set.releaseDate
```

Website shop:

```text
https://crackpacks.com/shop.html#card-database
```
