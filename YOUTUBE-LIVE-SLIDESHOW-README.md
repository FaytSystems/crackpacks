# Crack Packs — Automatic YouTube Live Room + Offline Artwork Slideshow v1.6.0

Repository root:

`D:\crackpacks\crackpacks-github-ready`

## What this adds

The Crack Packs homepage now contains one responsive 16:9 live-room interface with two automatic modes:

- **YouTube live mode:** embeds the current Crack Packs livestream, displays the stream title, optional concurrent-viewer count, YouTube links, and live status.
- **Offline mode:** displays an animated slideshow made from the existing original Crack Packs electric, flame, cosmic, and vintage artwork.
- **Upcoming mode:** keeps the artwork visible while showing the next scheduled livestream and its local start time.
- **Safe fallback mode:** if YouTube or the Worker is unavailable, the slideshow remains active and the rest of the website continues working.

The existing **Card Search & Price Check** navigation, card API, shop, release calendar, first-party Live Hub, and original site files are preserved.

## Complete replacement and new files

- `D:\crackpacks\crackpacks-github-ready\index.html`
- `D:\crackpacks\crackpacks-github-ready\assets\js\config.js`
- `D:\crackpacks\crackpacks-github-ready\assets\css\youtube-live.css`
- `D:\crackpacks\crackpacks-github-ready\assets\js\youtube-live.js`
- `D:\crackpacks\crackpacks-github-ready\youtube-live-worker\src\index.js`
- `D:\crackpacks\crackpacks-github-ready\youtube-live-worker\wrangler.jsonc`
- `D:\crackpacks\crackpacks-github-ready\youtube-live-worker\package.json`
- `D:\crackpacks\crackpacks-github-ready\youtube-live-worker\deploy-worker.ps1`
- `D:\crackpacks\crackpacks-github-ready\YOUTUBE-LIVE-SLIDESHOW-README.md`
- `D:\crackpacks\crackpacks-github-ready\PACKAGE-MANIFEST.json`

The existing shared files remain in place and are not partially patched:

- `assets\css\styles.css`
- `assets\js\app.js`
- `assets\js\data.js`
- `assets\js\card-lookup.js`
- `cloudflare-worker\src\index.js`

The YouTube system uses a **separate Cloudflare Worker** so it cannot interfere with the existing card-search API.

## One-command installation, Worker deployment, secret setup, commit, and push

Extract this package, open PowerShell in the extracted folder, and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\install-crackpacks-youtube-live-v1.6.0.ps1 `
  -RepoRoot "D:\crackpacks\crackpacks-github-ready" `
  -DeployWorker `
  -SetWorkerSecrets `
  -Push
```

Wrangler will prompt for two encrypted values:

1. `YOUTUBE_API_KEY` — a YouTube Data API v3 key.
2. `YOUTUBE_CHANNEL_ID` — the Crack Packs YouTube channel ID, normally beginning with `UC`.

The API key and channel ID are stored as encrypted Cloudflare Worker secrets. They are never placed in the public website JavaScript or GitHub repository.

## Install without deploying or pushing

```powershell
.\install-crackpacks-youtube-live-v1.6.0.ps1 `
  -RepoRoot "D:\crackpacks\crackpacks-github-ready"
```

This immediately installs and activates the offline artwork interface. Automatic YouTube detection remains in setup mode until the Worker secrets and custom domain are configured.

## Create the YouTube API key

1. Open Google Cloud Console.
2. Create or select the project used for Crack Packs.
3. Enable **YouTube Data API v3**.
4. Open **APIs & Services → Credentials**.
5. Create an API key.
6. Restrict the key to **YouTube Data API v3**.
7. Do not place the key in `config.js`, GitHub, HTML, or browser JavaScript.

## Find the YouTube channel ID

Use the channel ID shown in YouTube Studio or the channel's advanced settings. Use the permanent channel ID, not only the `@handle`.

The ID normally looks like:

```text
UCxxxxxxxxxxxxxxxxxxxxxx
```

## Add the Worker custom domain

After the Worker deploys:

1. Open **Cloudflare Dashboard → Workers & Pages**.
2. Open the Worker named **crackpacks-youtube-live**.
3. Open **Settings → Domains & Routes**.
4. Add the custom domain:

```text
live-api.crackpacks.com
```

5. Wait for Cloudflare to activate the hostname.

The website is already configured to request:

```text
https://live-api.crackpacks.com/status
```

## Validation URLs

Open these after deployment:

```text
https://live-api.crackpacks.com/health
https://live-api.crackpacks.com/status
https://crackpacks.com/#crack-packs-live
```

Expected configured health response:

```json
{
  "ok": true,
  "service": "crackpacks-youtube-live",
  "version": "1.6.0",
  "configured": true,
  "endpoints": ["/health", "/status"]
}
```

Expected offline status shape:

```json
{
  "ok": true,
  "configured": true,
  "live": false,
  "channelUrl": "https://www.youtube.com/channel/CHANNEL_ID",
  "upcoming": null
}
```

When live, the response also contains the current `videoId`, title, description, watch URL, start time, thumbnail, and viewer count when YouTube returns it.

## Local website preview

```powershell
Set-Location "D:\crackpacks\crackpacks-github-ready"
python -m http.server 8080
```

Open:

```text
http://localhost:8080/#crack-packs-live
```

The Cloudflare Worker allows localhost origins for development.

## Manual live-player test before the channel is configured

Open the complete file:

`D:\crackpacks\crackpacks-github-ready\assets\js\config.js`

Temporarily set a valid public YouTube video ID:

```js
youtubeManualVideoId: "M7lc1UVf-VE",
```

Reload the page. The interface will enter live-player test mode.

After testing, restore the complete setting to:

```js
youtubeManualVideoId: "",
```

Do not use manual mode as the permanent production configuration because it does not detect whether the channel is actually live.

## Detection and quota design

The Worker is designed to avoid wasteful API polling:

- Uses the channel's public XML video feed for recent candidate IDs.
- Uses a cached YouTube search discovery request once per hour as a reliability fallback.
- Uses the low-cost `videos.list` endpoint to confirm live, upcoming, or completed state.
- Caches the public `/status` response for approximately 45 seconds.
- The browser checks the Worker once per minute, not YouTube directly.

Every visitor shares the Cloudflare cache, so traffic to the website does not multiply YouTube API requests linearly.

## Artwork and intellectual-property safety

The offline slideshow uses the existing original Crack Packs abstract artwork files:

- `assets\images\banner-electric.svg`
- `assets\images\banner-flame.svg`
- `assets\images\banner-cosmic.svg`
- `assets\images\banner-vintage.svg`

It does not add copied Pokémon characters, official card artwork, official packaging, or Pokémon logos.

## Updating slideshow timing

Open the complete file:

`D:\crackpacks\crackpacks-github-ready\assets\js\config.js`

Current timing:

```js
youtubeStatusRefreshMs: 60000,
youtubeSlideshowMs: 6500,
youtubeRequestTimeoutMs: 8000,
```

- `youtubeStatusRefreshMs` controls how often the browser checks the cached Worker response.
- `youtubeSlideshowMs` controls artwork rotation speed.
- `youtubeRequestTimeoutMs` controls how long the browser waits before using the offline fallback.

## Updating or replacing artwork

Keep the existing filenames to replace artwork without editing code, or update each complete slide declaration in:

`D:\crackpacks\crackpacks-github-ready\index.html`

Each artwork file should remain responsive, web-optimized, legally cleared, and suitable for a 16:9 display.

## Security guarantees

- No YouTube API key in public JavaScript.
- No YouTube API key in GitHub.
- No modification to the Pokémon card-search Worker.
- Strict video-ID validation before creating an iframe.
- HTTPS-only production endpoints.
- Restricted production CORS origins.
- Safe offline fallback after errors or timeouts.
- No arbitrary HTML from YouTube is inserted into the page.
