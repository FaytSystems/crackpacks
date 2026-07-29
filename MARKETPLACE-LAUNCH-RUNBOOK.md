# Crack Packs Marketplace Launch Runbook

The production marketplace stays in `preview` until seller payouts, real inventory,
shipping, and buyer billing have all been checked. Preview mode allows browsing but
does not allow Store checkout.

## 1. Stripe Connect webhooks

Keep the existing Stripe account webhook pointed at:

`https://rewards-api.crackpacks.com/webhooks/stripe`

Create a second Stripe event destination for **Connected accounts** at the same URL.
Subscribe it to `account.updated`. Save that destination's signing secret as:

```powershell
Set-Location .\rewards-worker
Get-Clipboard | npx.cmd wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET
Set-Clipboard -Value ""
```

The account webhook should continue sending the checkout, PaymentIntent, invoice,
subscription, refund, and Identity events already used by the Worker. Each event
destination has its own `whsec_...` signing secret.

## 2. Contact Turnstile

The contact Worker is deployed with Turnstile staged but not required. After creating
a Turnstile widget for `crackpacks.com` and `www.crackpacks.com`, install its secret:

```powershell
Set-Location .\contact-worker
Get-Clipboard | npx.cmd wrangler secret put TURNSTILE_SECRET_KEY
Set-Clipboard -Value ""
```

Then change `TURNSTILE_REQUIRED` to `"true"` in `contact-worker/wrangler.jsonc` and run:

```powershell
npx.cmd wrangler deploy
```

Never place the secret key in Git, HTML, JavaScript, or `wrangler.jsonc`.

## 3. Seller readiness

For at least one seller, verify all of the following in Seller Hub:

- Stripe Identity accepted and internal seller access active
- Stripe Connect shows charges and payouts enabled with no requirements due
- OBS connection created and tested
- At least one active Store listing with real quantity and image
- At least one shipping weight/profile configuration
- Stream Credit balance above `0.00`
- A scheduled show with at least one queued auction

The seller cannot open a paid auction until Stripe Connect is ready.

## 4. Launch rehearsal

Run the production checks from `rewards-worker`:

```powershell
npm.cmd run launch:rehearse
```

Preview mode is expected to pass. The report must show rewards, real-time auctions,
seller payout gate, contact email, and card API as `READY`.

## 5. Enable checkout

Only after the seller-readiness checklist and a live-mode Stripe test purchase pass:

1. Set `MARKETPLACE_MODE` to `"live"`.
2. Set `STORE_COMING_SOON` to `"false"`.
3. Set `STORE_CHECKOUT_ENABLED` to `"true"`.
4. Deploy `rewards-worker`.
5. Run the strict rehearsal:

```powershell
npm.cmd run launch:rehearse -- --require-live
```

To stop new Store checkout immediately, set `MARKETPLACE_MODE` to `"paused"` and
redeploy. Existing paid orders remain available for fulfillment.
