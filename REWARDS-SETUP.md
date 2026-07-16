# Crack Packs Rewards setup

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
5. Run `npm run db:remote`.
6. Configure Cloudflare Email Routing so `rewards@crackpacks.com` may send.
7. Run `npm run deploy`.
8. Confirm `https://rewards-api.crackpacks.com/health`.

9. Create a free Cloudflare Turnstile widget for `crackpacks.com`, put its public site key in `assets/js/config.js`, and put its secret in the Worker secret above.

10. Create a free Resend account, verify `crackpacks.com` (or change the Worker sender to a verified sending subdomain), create a sending-only API key, and store it as `RESEND_API_KEY`. The free Resend tier currently includes 3,000 emails per month with a 100-email daily limit.

`ADMIN_EMAIL` is the one exact email allowed to open the owner dashboard. `DISCOUNT_NOTIFY_EMAIL` receives member redemption-request alerts. Keep both out of `wrangler.jsonc` if they identify a private owner account. Database deployment uses the versioned SQL files in `rewards-worker/migrations`; `schema.sql` is the current schema snapshot and should not be used as an upgrade command for an existing database.

For local UI testing, serve the repository on `http://localhost:8080`. WebAuthn production registration requires HTTPS and the exact `crackpacks.com` relying-party domain. The QR images currently use `api.qrserver.com`; vendor a reviewed QR library if the campaign requires QR generation without a third-party image request.

## Sticker destination

Print the durable campaign URL:

`https://crackpacks.com/referral.html`

Do not print a discount code directly. The page requires verified sign-in before issuing a one-time code.
