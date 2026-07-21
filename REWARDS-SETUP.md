# Crack Packs Rewards setup

## Store checkout v4 production requirements

The store remains fail-closed until both `STORE_COMING_SOON=false` and
`STORE_CHECKOUT_ENABLED=true` are deployed. Keep both disabled until every
sale item has a verified quantity, product price, packed weight, packed
dimensions, and (for international sale) origin country and HS code.

Required Worker secrets:

- `STRIPE_SECRET_KEY` — Stripe production secret key.
- `STRIPE_WEBHOOK_SECRET` — signing secret for `https://rewards-api.crackpacks.com/webhooks/stripe`.
- `EASYPOST_API_KEY` and `EASYPOST_WEBHOOK_SECRET` — live rates and tracking.
- `SHIP_FROM_ADDRESS_JSON` — real ship-from name, address, phone, and email.
- `RESEND_API_KEY` — verified `crackpacks.com` sending domain.
- `BUSINESS_POSTAL_ADDRESS` — valid postal address shown in member announcements.

Subscribe the Stripe webhook to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`, and
`charge.refunded`.

Stripe public business links:

- Terms: `https://crackpacks.com/terms.html`
- Privacy: `https://crackpacks.com/privacy.html`
- Shipping: `https://crackpacks.com/shipping-policy.html`
- Returns: `https://crackpacks.com/returns-policy.html`
- Support: `support@crackpacks.com`

Order, shipping, delivery, and refund mail is sent from
`orders@crackpacks.com`. Code Generator rewards default to
`rewards@crackpacks.com`. The owner dashboard email composer can send from
`rewards@crackpacks.com`, `alerts@crackpacks.com`, `orders@crackpacks.com`,
`support@crackpacks.com`, or `hello@crackpacks.com`. New paid-order notices go
to `robertreese@faytsystems.com`.

Label purchase remains manual. Payment creates the order and preserves the
EasyPost shipment/rate choice; the owner buys the label separately and attaches
its tracking number in the Master Dashboard.

The website UI and Worker backend are implemented, but the backend must be configured before real customers use it.

## Security boundary

Email verification, legal name, date of birth, a unique Whatnot username, hashed identity fingerprints, rate limits, self-referral prevention, and database uniqueness rules reduce abuse. They do **not** prove that one physical human has only one account. Whatnot does not provide a general-purpose identity guarantee merely because an email is entered.

The included internal checker accepts any valid verified email address and enforces one account per email, a required WebAuthn passkey, unique collector usernames, and a salted one-way identity fingerprint made from normalized legal name plus birth date. Cloudflare Turnstile blocks automated signup abuse. Exact duplicate identities and reused passkey credentials are blocked. Suspicious cases should be manually reviewed. Publish official eligibility, privacy, prize, expiration, tax, geographic, and no-purchase-necessary rules before launch.

## Deploy

1. In `rewards-worker`, run `npm install`.
2. Run `npx wrangler d1 create crackpacks-rewards`.
3. Put the returned database ID in `wrangler.jsonc`.
4. Create secrets:
   - `npx wrangler secret put AUTH_SECRET`
   - `npx wrangler secret put IDENTITY_PEPPER`
   - `npx wrangler secret put TURNSTILE_SECRET_KEY`
   - `npx wrangler secret put RESEND_API_KEY`
   - `npx wrangler secret put ADMIN_EMAIL`
   - `npx wrangler secret put DISCOUNT_NOTIFY_EMAIL`
   - `npx wrangler secret put OWNER_REFERRAL_SECRET`
   - `npx wrangler secret put EASYPOST_TEST_API_KEY`
   - `npx wrangler secret put SHIP_FROM_ADDRESS_JSON`
5. Run `npm run db:remote`.
6. Configure Cloudflare Email Routing so `rewards@crackpacks.com`,
   `orders@crackpacks.com`, `alerts@crackpacks.com`,
   `support@crackpacks.com`, and `hello@crackpacks.com` route to the inboxes
   you want to monitor. Also verify the `crackpacks.com` sender domain in
   Resend so those addresses can send from the owner email composer.
7. Run `npm run deploy`.
8. Confirm `https://rewards-api.crackpacks.com/health`.

9. Create a free Cloudflare Turnstile widget for `crackpacks.com`, put its public site key in `assets/js/config.js`, and put its secret in the Worker secret above.

10. Create a free Resend account, verify `crackpacks.com` (or change the Worker sender to a verified sending subdomain), create a sending-only API key, and store it as `RESEND_API_KEY`. The free Resend tier currently includes 3,000 emails per month with a 100-email daily limit.

`ADMIN_EMAIL` is the one exact email allowed to open the owner dashboard. `DISCOUNT_NOTIFY_EMAIL` receives member redemption-request alerts. `OWNER_REFERRAL_SECRET` signs the opaque 12-hour owner campaign URLs and should be an independent random secret. Keep these values out of `wrangler.jsonc`. Database deployment uses the versioned SQL files in `rewards-worker/migrations`; `schema.sql` is the current schema snapshot and should not be used as an upgrade command for an existing database.

For local UI testing, serve the repository on `http://localhost:8080`. WebAuthn production registration requires HTTPS and the exact `crackpacks.com` relying-party domain. Referral QR images are generated inside the authenticated Crack Packs flow; signed owner referral URLs are not sent to a third-party QR service.

## Sticker destination

Print the durable campaign URL:

`https://crackpacks.com/referral.html`

Do not print a discount code directly. The page requires verified sign-in before issuing a one-time code.

The owner dashboard generates an additional signed digital referral QR that changes at 7:00 AM and 7:00 PM Eastern. Downloaded copies expire at the next boundary. A physically printed QR cannot rotate, so use the durable campaign URL above for permanent sticker inventory and the owner dashboard QR for time-limited digital posts.

## Public offer campaigns

Rewards Worker 3.2.0 provides owner-created offer campaigns, inventory-linked product rewards, protected channel price floors, and an owner-only EasyPost test-mode probe. Apply the pending versioned migrations with `npm run db:remote` before deploying the Worker. Migration `0003` creates campaign, redemption, and weekly reward-ledger tables; additive migration `0004` enables free-single campaigns, additive migration `0005` enables explicit indefinite campaigns, additive migration `0006` adds server-side kill switches for every master referral and campaign QR, additive migration `0007` adds owner inventory, product campaign snapshots, and short-lived shipping quote records, migrations `0008` through `0010` add one atomic inventory-safety trigger apiece, and additive migration `0011` adds channel cost inputs plus owner list-price overrides.

Only the verified owner account with a fresh passkey step-up may create campaigns, list campaign members, generate campaign QR codes, or mark rewards redeemed. Supported reward types are:

- `percent` with a required whole-number `percent` from 1 through 100.
- `free_shipping`.
- `pick_a_pack`.
- `pack_draft` with a required numbered pack choice. `packCount` must be at least `maxRedemptions`.
- `free_single` for a free holographic single. Use `maxRedemptions` to cap the shipment giveaway, such as the first 50 verified claims.
- `product` for a current active inventory item selected by name or UPC. Product campaigns snapshot the name and UPC at creation so old claims remain auditable after an inventory edit.

Campaigns may last from 1 hour through 7 days (168 hours), or may be explicitly Indefinite, and may allow up to 500 redemptions. The owner dashboard accepts hours or days; day values support thousandth-day precision, such as `3.05`. Indefinite campaigns remain claimable until their redemption cap is reached and should be manually retired by controlling distribution of their link. Offer URLs use an unguessable public token at `https://crackpacks.com/referral.html?offer=TOKEN`. The token identifies a public offer; it never authenticates the owner or grants dashboard access. Campaign QR images are rendered inside the Worker and do not send offer URLs to a third-party QR service.

Members must finish email, passkey, and identity verification before claiming. The owner cannot claim their own campaign. Each campaign code and claim rank is unique, and pack draft numbers can be selected only once. A member may receive only one newly issued reward code per Thursday-to-Wednesday week, resetting Thursday at 12:00 AM in `America/New_York`. This weekly rule covers both campaign claims and the legacy one-time discount code. Reopening the same already-claimed campaign or legacy discount remains idempotent and returns the existing code.

Campaign API routes:

- `POST /admin/campaigns` creates a campaign after fresh owner verification.
- `GET /admin/campaigns` returns campaigns and their member redemption records.
- `POST /admin/campaigns/:id/qr` returns a first-party SVG QR.
- `POST /admin/campaign-redemptions/:id/redeem` permanently marks one campaign reward used.
- `POST /campaign/status` accepts `{ "offerToken": "..." }` and returns public-safe availability.
- `POST /campaign/claim` accepts `{ "offerToken": "...", "packNumber": 1 }`; `packNumber` is used only for pack drafts.
- `GET /campaigns/mine` returns the signed-in member's campaign history and legacy discount, if any.

The email sign-in request may include a bounded public `offerToken`. When it resolves to a campaign, the email verification link carries the same `offer` query parameter back to the site so a scanned offer is not lost during sign-in.

## Inventory, storefront, and shipping

The protected Inventory tab is the source of truth for campaign products and the public USA/international store previews. The starter-catalog importer adds verified product references with zero stock. It never invents COGS or availability. Before enabling a product, enter actual on-hand quantity, landed COGS, packed weight and all three packed dimensions, the documented reference-price source/date, and for international shipping the origin country and HS tariff code.

The pricing engine treats every result as a minimum floor, never a market-price cap. The saved channel price is the higher of the calculated floor or the owner's optional market/list price:

- Retail: `(landed COGS + overhead + retail fixed fee) ÷ (1 - 2.7% - 25%)`.
- USA website: `(landed COGS + postage + packaging + overhead + $0.30) ÷ (1 - 2.9% - 20%)`.
- International website item price: the website formula without postage; shipping is quoted separately.
- Whatnot: `(landed COGS + packaging + overhead + $0.30) ÷ (1 - 12% - 18%)`; buyer-paid shipping is assumed.
- Wholesale: `(landed COGS + handling) ÷ (1 - margin)`, using 15% for small reseller orders, 12% for cases, and 10% for pallet/very large orders. ACH or wire (0% payment fee) and buyer-paid freight are assumed unless a documented minimum-order policy says otherwise.

The API rejects owner list-price overrides below their applicable floor and does not expose COGS or floor components publicly. `STORE_COMING_SOON` and `STORE_CHECKOUT_ENABLED` remain locked down until every product, fee assumption, and checkout flow is verified.

Public inventory never returns owner IDs, inventory IDs, UPCs, COGS, private packing notes, or exact on-hand counts. Owner routes require the normal member bearer token plus a fresh passkey-backed `X-Admin-Token`:

- `GET /admin/inventory?q=QUERY&available=1`
- `POST /admin/inventory`
- `POST /admin/inventory/:id`
- `POST /admin/inventory/catalog/import`
- `GET /store/inventory?market=us&currency=USD`
- `POST /store/shipping-quote` (disabled while Coming Soon)

EasyPost is the rate-shopping adapter. Postage is not free even when the API/platform tier is free. Start with its test key:

```powershell
cd "D:\crackpacks\crackpacks-github-ready\rewards-worker"
npx.cmd wrangler secret put EASYPOST_TEST_API_KEY
npx.cmd wrangler secret put SHIP_FROM_ADDRESS_JSON
```

`SHIP_FROM_ADDRESS_JSON` is a single-line JSON secret, for example:

```json
{"name":"Crack Packs","street1":"YOUR STREET","street2":"","city":"YOUR CITY","state":"YOUR STATE","postalCode":"YOUR ZIP","country":"US","phone":"YOUR PHONE","email":"shipping@crackpacks.com"}
```

After both secrets are stored, open **Master Dashboard → Inventory → Test EasyPost**. The protected action requires a fresh owner passkey session and uses only `EASYPOST_TEST_API_KEY`. It creates an 8 oz, 6 × 4 × 2 inch test-mode shipment to EasyPost's published sample address, returns up to six carrier rates, and never purchases a label. The ship-from secret is sent to EasyPost for rating but is never returned to the browser or stored in the database.

Get the test/production API keys from the EasyPost dashboard under **Account Settings → API Keys**. Never place an EasyPost or Stripe secret in `assets/js/config.js`. Keep `STORE_COMING_SOON` set to `"true"` and `STORE_CHECKOUT_ENABLED` set to `"false"` until test quotes, stock reservation, Stripe webhook verification, fulfillment, returns, and legal policies have been end-to-end tested. When live checkout is implemented, add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` using `wrangler secret put`; do not add them yet merely to render the Coming Soon store.

International parcels below US$2,500 use EasyPost's standard `NOEEI 30.37(a)` export exemption automatically. If a shipment can reach US$2,500 or more, first obtain the correct AES proof-of-filing citation and store it with `npx.cmd wrangler secret put EASYPOST_EEL_PFC`; the quote adapter deliberately refuses a high-value customs quote without that configuration.

Product campaigns reserve inventory while active. Turning a campaign off releases only its unclaimed slots; already-claimed rewards stay reserved. Turning it back on is rejected if another campaign used the released capacity. Marking a product reward redeemed removes one physical unit from on-hand inventory, and inventory quantity cannot be lowered below outstanding campaign commitments.

International UI uses DAP (formerly DDU) language: the recipient/importer pays destination duties, taxes, customs/brokerage, clearance, and carrier collection fees. ECB reference rates are used only for approximate display conversion. Actual checkout amounts must be locked by Stripe, and the card issuer's conversion can differ.
