import assert from "node:assert/strict";
import test from "node:test";
import { issueOwnerReferral, ownerReferralSlotAt, verifyOwnerReferral } from "../src/referral-rotation.js";

const vectors = [
  ["2026-07-16T10:59:59.999Z", "2026-07-15-19", "2026-07-15T23:00:00.000Z", "2026-07-16T11:00:00.000Z"],
  ["2026-07-16T11:00:00.000Z", "2026-07-16-07", "2026-07-16T11:00:00.000Z", "2026-07-16T23:00:00.000Z"],
  ["2026-07-16T23:00:00.000Z", "2026-07-16-19", "2026-07-16T23:00:00.000Z", "2026-07-17T11:00:00.000Z"],
  ["2026-03-08T10:59:59.000Z", "2026-03-07-19", "2026-03-08T00:00:00.000Z", "2026-03-08T11:00:00.000Z"],
  ["2026-03-08T11:00:00.000Z", "2026-03-08-07", "2026-03-08T11:00:00.000Z", "2026-03-08T23:00:00.000Z"],
  ["2026-11-01T11:59:59.000Z", "2026-10-31-19", "2026-10-31T23:00:00.000Z", "2026-11-01T12:00:00.000Z"],
  ["2026-11-01T12:00:00.000Z", "2026-11-01-07", "2026-11-01T12:00:00.000Z", "2026-11-02T00:00:00.000Z"],
  ["2027-01-01T11:59:59.000Z", "2026-12-31-19", "2027-01-01T00:00:00.000Z", "2027-01-01T12:00:00.000Z"]
];

test("owner referral windows follow 7 AM and 7 PM New York boundaries", () => {
  for (const [at, id, startsAt, expiresAt] of vectors) {
    assert.deepEqual(ownerReferralSlotAt(Date.parse(at)), {
      id,
      startsAt,
      expiresAt,
      label: id.endsWith("-07") ? "7:00 AM–7:00 PM ET" : "7:00 PM–7:00 AM ET",
      nextBoundaryLabel: id.endsWith("-07") ? "7:00 PM Eastern" : "7:00 AM Eastern"
    });
  }
});

test("only the exact current opaque owner token verifies", async () => {
  const site = "https://crackpacks.com";
  const owner = "owner-member-id";
  const secret = "test-only-owner-referral-secret-1";
  const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const issuedAt = Date.parse("2026-07-16T12:00:00.000Z");
  const issued = await issueOwnerReferral(site, owner, secret, issuedAt);
  assert.match(issued.token, /^v1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(issued.url).searchParams.get("owner_ref"), issued.token);
  assert.equal(await verifyOwnerReferral(issued.token, site, owner, secret, Date.parse("2026-07-16T22:59:59.999Z")), true);
  assert.equal(await verifyOwnerReferral(issued.token, site, owner, secret, Date.parse("2026-07-16T23:00:00.000Z")), false);
  assert.equal(await verifyOwnerReferral(`${issued.token}x`, site, owner, secret, issuedAt), false);
  const finalCharacterIndex = base64urlAlphabet.indexOf(issued.token.at(-1));
  assert.equal(finalCharacterIndex % 16, 0);
  const noncanonicalFinal = base64urlAlphabet[finalCharacterIndex + 1];
  assert.equal(await verifyOwnerReferral(`${issued.token.slice(0, -1)}${noncanonicalFinal}`, site, owner, secret, issuedAt), false);
  assert.equal(await verifyOwnerReferral(issued.token, site, "another-owner", secret, issuedAt), false);
  assert.equal(await verifyOwnerReferral(issued.token, "https://example.com", owner, secret, issuedAt), false);
  assert.equal(await verifyOwnerReferral(issued.token, site, owner, "another-secret", issuedAt), false);
});
