import assert from "node:assert/strict";
import test from "node:test";
import { chooseBestRecordingForSession, hasMasterPortalAccess, hasSellerPortalAccess, hasVerifiedSellerIdentity, isMasterEmail, usernameKey } from "../src/platform-routes.js";

test("Crack Packs User ID key blocks case, separator, and common leetspeak clones", () => {
  assert.equal(usernameKey("CRACKPACKS"), "crackpacks");
  assert.equal(usernameKey("Crack_Packs"), "crackpacks");
  assert.equal(usernameKey("CR4CKP4CK5"), "crackpacks");
  assert.equal(usernameKey("crack---packs"), "crackpacks");
});

test("distinct User IDs keep distinct protected keys", () => {
  assert.notEqual(usernameKey("CrackPacks"), usernameKey("HaloCollector"));
});

test("recording matcher prefers the video created closest to the show start", () => {
  const session = {
    started_at: "2026-07-23T19:00:00.000Z",
    ended_at: "2026-07-23T21:00:00.000Z"
  };
  const chosen = chooseBestRecordingForSession(session, [
    { uid: "late", created: "2026-07-23T21:30:00.000Z" },
    { uid: "best", created: "2026-07-23T19:01:00.000Z" },
    { uid: "early", created: "2026-07-23T18:58:00.000Z" }
  ]);
  assert.equal(chosen.uid, "best");
});

test("seller access requires email, passkey, internal state, and Stripe Identity", () => {
  const complete = {
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "RipWizardBreaks"
  };
  assert.equal(hasVerifiedSellerIdentity(complete), true);
  assert.equal(hasVerifiedSellerIdentity({ ...complete, stripe_identity_status: "not_started" }), false);
  assert.equal(hasVerifiedSellerIdentity({ ...complete, device_verified: 0 }), false);
  assert.equal(hasVerifiedSellerIdentity({ ...complete, identity_status: "pending_identity" }), false);
  assert.equal(hasSellerPortalAccess(complete, { status: "active" }), true);
  assert.equal(hasSellerPortalAccess({ ...complete, live_username: "" }, { status: "active" }), false);
  assert.equal(hasSellerPortalAccess(complete, { status: "pending" }), false);
});

test("master account recognizes configured emails but still requires ID verification", () => {
  const env = { ADMIN_EMAIL: "owner@crackpacks.com", MASTER_EMAILS: "robertreese@faytsystems.com" };
  const complete = {
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified"
  };
  assert.equal(isMasterEmail("robertreese@faytsystems.com", env), true);
  assert.equal(hasMasterPortalAccess(complete, env), true);
  assert.equal(hasMasterPortalAccess({ ...complete, stripe_identity_status: "not_started" }, env), false);
  assert.equal(hasMasterPortalAccess({ ...complete, device_verified: 0 }, env), false);
  assert.equal(hasMasterPortalAccess({ ...complete, email: "seller@example.com" }, env), false);
});
