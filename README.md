# CrackPacks.com

Static storefront and release-radar website for **Crack Packs**.

Repository: `FaytSystems/crackpacks`

## Included

- `index.html` — homepage
- `shop.html` — searchable/filterable shop
- `releases.html` — release calendar with live countdowns
- `404.html` — custom error page
- `assets/css/styles.css` — complete responsive visual system
- `assets/js/config.js` — Whatnot URL, email, site status, update date
- `assets/js/data.js` — products, prices, stock labels, images, links, and releases
- `assets/js/app.js` — rendering, filters, slideshow, countdowns, mobile navigation
- `.github/workflows/pages.yml` — GitHub Pages deployment
- `deploy-to-github.ps1` — initializes, commits, and pushes the full site to `FaytSystems/crackpacks`
- `CNAME` — custom domain mapping for `crackpacks.com`
- `.nojekyll` — disables Jekyll processing

## Required edits before launch

### 1. Add the real Whatnot profile

Open:

`assets/js/config.js`

Replace:

```js
whatnotUrl: "https://www.whatnot.com/user/YOUR_USERNAME"
```

with the actual profile URL.

Also replace every `YOUR_USERNAME` placeholder in:

`assets/js/data.js`

A repository-wide search for `YOUR_USERNAME` will find all placeholders.

### 2. Replace preview inventory

Open:

`assets/js/data.js`

Edit each product's:

- `name`
- `category`
- `priceLabel`
- `stockLabel`
- `description`
- `image`
- `url`
- `featured`
- `enabled`

Product links may point to Whatnot, Shopify, Stripe Payment Links, Square, WooCommerce, or another checkout page.

### 3. Use legally cleared product images

The included banners and product visuals are original abstract Crack Packs artwork. They do not depict Pokémon characters or official packaging.

For real product photos, use only:

- Photos taken by Crack Packs
- Images supplied by an authorized distributor under its usage terms
- Images for which Crack Packs has written permission or a valid license

Do not assume that an image being visible on Pokémon, retailer, marketplace, or search-engine pages grants permission to copy it into the site.

### 4. Connect the newsletter form

The form is visual only. Connect it to Mailchimp, Klaviyo, ConvertKit, Brevo, or another provider before collecting addresses.

## Deploy to GitHub Pages

The included workflow deploys the repository whenever `main` is updated.

Fastest method from PowerShell after extracting the project:

```powershell
cd C:\path\to\crackpacks
.\deploy-to-github.ps1
```

Manual method:

```powershell
cd C:\path\to\crackpacks

git init
git branch -M main
git remote add origin https://github.com/FaytSystems/crackpacks.git
git add .
git commit -m "Launch Crack Packs storefront"
git push -u origin main
```

In GitHub:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Let the included `Deploy Crack Packs to GitHub Pages` workflow finish.
4. Confirm the custom domain is `crackpacks.com`.

## Domain DNS

For an apex domain on GitHub Pages, GitHub normally documents these `A` records:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

For `www`, use a `CNAME` pointing to:

`faytsystems.github.io`

Recheck GitHub's current Pages documentation before changing DNS because hosting requirements can change.

## Preview locally

```powershell
cd C:\path\to\crackpacks
python -m http.server 8080
```

Open:

`http://localhost:8080`

## Release data currently seeded

The site includes verified information available on July 15, 2026 for:

- Mega Evolution—Pitch Black Booster Box — July 17, 2026
- Mega Evolution—Pitch Black Elite Trainer Box — July 17, 2026
- Mega Evolution—Pitch Black Booster Bundle — July 17, 2026
- Mega Evolution—Pitch Black Three-Pack Booster — July 17, 2026
- Mega Evolution—Phantasmal Flames Elite Trainer Box — released November 14, 2025

Source links are stored with each release in `assets/js/data.js`.

Release dates and availability can change. Recheck every source before publishing or advertising a launch.
