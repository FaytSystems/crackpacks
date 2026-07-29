import assert from "node:assert/strict";
import test from "node:test";
import { stripeFormBody, stripeRequest, verifyStripeWebhook } from "../src/stripe-commerce.js";

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

test("Stripe request errors preserve the declined PaymentIntent for settlement recovery", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      type: "card_error",
      code: "card_declined",
      decline_code: "insufficient_funds",
      message: "Your card was declined.",
      payment_intent: { id: "pi_declined", status: "requires_payment_method" }
    }
  }), { status: 402, headers: { "Content-Type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    stripeRequest("sk_test_example", "/payment_intents", [["amount", 2500]], "auction-lot-1"),
    error => {
      assert.equal(error.message, "STRIPE_PROVIDER_ERROR");
      assert.equal(error.stripeStatus, 402);
      assert.equal(error.stripeDeclineCode, "insufficient_funds");
      assert.equal(error.stripePaymentIntent.id, "pi_declined");
      return true;
    }
  );
});
