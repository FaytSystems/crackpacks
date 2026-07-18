import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeEasyPostTracker, verifyEasyPostWebhook } from "../src/easypost-tracking.js";

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");

async function signature(secret, timestamp, path, body) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}POST${path}${body}`));
  return `hmac-sha256-hex=${hex(bytes)}`;
}

test("EasyPost v2 HMAC accepts an exact fresh body and rejects tampering", async () => {
  const secret = "unit-test-webhook-secret";
  const timestamp = "Sat, 18 Jul 2026 16:00:00 -0400";
  const path = "/webhooks/easypost";
  const body = '{"id":"evt_test","description":"tracker.updated"}';
  const signed = await signature(secret, timestamp, path, body);
  const nowMs = Date.parse(timestamp) + 10_000;
  assert.deepEqual(await verifyEasyPostWebhook({ secret, timestamp, path, signature: signed, rawBody: body, nowMs }), { ok: true, reason: "verified" });
  assert.equal((await verifyEasyPostWebhook({ secret, timestamp, path, signature: signed, rawBody: `${body} `, nowMs })).ok, false);
  assert.equal((await verifyEasyPostWebhook({ secret, timestamp, path, signature: signed, rawBody: body, nowMs: nowMs + 120_000 })).reason, "stale_timestamp");
});

test("tracker sanitizer keeps useful scan history without exact addresses", () => {
  const tracker = sanitizeEasyPostTracker({
    id: "trk_123abc", object: "Tracker", mode: "test", tracking_code: "EZ4000000004", carrier: "USPS",
    status: "delivered", status_detail: "status_update", est_delivery_date: "2026-07-18T20:00:00Z",
    public_url: "https://track.easypost.com/example",
    tracking_details: [{ status: "delivered", status_detail: "status_update", message: "Delivered", datetime: "2026-07-18T19:00:00Z", source: "USPS", tracking_location: { city: "Orlando", state: "FL", country: "US", zip: "32801" } }]
  });
  assert.equal(tracker.status, "delivered");
  assert.equal(tracker.details[0].location.city, "Orlando");
  assert.equal("zip" in tracker.details[0].location, false);
});
