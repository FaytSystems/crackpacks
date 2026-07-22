import assert from "node:assert/strict";
import test from "node:test";
import { stripeFormBody, verifyStripeWebhook } from "../src/stripe-commerce.js";

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");

async function stripeSignature(secret, timestamp, body) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

test("Stripe webhook signature accepts the exact fresh payload and rejects tampering", async () => {
  const secret = "whsec_test_secret";
  const timestamp = Math.floor(Date.parse("2026-07-18T18:00:00Z") / 1000);
  const body = '{"id":"evt_123","type":"checkout.session.completed"}';
  const signature = await stripeSignature(secret, timestamp, body);
  const header = `t=${timestamp},v1=${signature}`;
  assert.deepEqual(await verifyStripeWebhook({ rawBody: body, signatureHeader: header, secret, nowMs: timestamp * 1000 }), { ok: true });
  assert.equal((await verifyStripeWebhook({ rawBody: `${body} `, signatureHeader: header, secret, nowMs: timestamp * 1000 })).ok, false);
  assert.equal((await verifyStripeWebhook({ rawBody: body, signatureHeader: header, secret, nowMs: (timestamp + 301) * 1000 })).error, "stale");
});

test("Stripe form encoder preserves nested parameter names", () => {
  const body = stripeFormBody([["mode", "payment"], ["line_items[0][quantity]", 1], ["metadata[checkout_id]", "abc"]]);
  assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("line_items[0][quantity]"), "1");
  assert.equal(body.get("metadata[checkout_id]"), "abc");
});
