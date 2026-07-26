import assert from "node:assert/strict";
import test from "node:test";
import { chooseBestRecordingForSession, handlePlatformRoute, hasMasterPortalAccess, hasSellerPortalAccess, hasVerifiedSellerIdentity, isMasterEmail, usernameKey } from "../src/platform-routes.js";

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

test("identity session force starts a fresh Stripe check for already verified accounts", async t => {
  const originalFetch = globalThis.fetch;
  const stripeCalls = [];
  globalThis.fetch = async (url, options) => {
    stripeCalls.push({ url: String(url), body: String(options?.body || "") });
    return new Response(JSON.stringify({ id: "vs_force_123", status: "requires_input", url: "https://verify.stripe.test/session" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const updates = [];
  const member = {
    id: "member-1",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_status: "verified",
    stripe_identity_status: "verified"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    SITE_URL: "https://crackpacks.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => sql.includes("JOIN members") ? member : null,
              run: async () => {
                updates.push({ sql, args });
                return { success: true };
              }
            };
          }
        };
      }
    }
  };
  const request = body => new Request("https://api.crackpacks.test/identity/session", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify(body)
  });

  const alreadyVerified = await handlePlatformRoute(request({}), env, {});
  assert.equal(alreadyVerified.status, 200);
  assert.deepEqual(await alreadyVerified.json(), { verified: true });
  assert.equal(stripeCalls.length, 0);

  const forced = await handlePlatformRoute(request({ force: true }), env, {});
  assert.equal(forced.status, 201);
  assert.deepEqual(await forced.json(), { url: "https://verify.stripe.test/session", status: "requires_input" });
  assert.equal(stripeCalls.length, 1);
  assert.match(stripeCalls[0].body, /type=document/);
  assert.match(stripeCalls[0].body, /metadata%5Bmember_id%5D=member-1/);
  assert.match(stripeCalls[0].body, /return_url=https%3A%2F%2Fcrackpacks\.com%2Freferral\.html%3Fidentity%3Dreturn%26return%3Dseller/);
  assert.equal(updates.length, 1);
});

test("identity session returns the Stripe provider reason when Stripe cannot start", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "account_invalid",
      message: "Your Stripe account cannot create Identity verification sessions yet."
    }
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const member = {
    id: "member-2",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_status: "pending_identity",
    stripe_identity_status: "not_started"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    SITE_URL: "https://crackpacks.com",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => sql.includes("JOIN members") ? member : null,
              run: async () => ({ success: true })
            };
          }
        };
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/identity/session", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ force: true })
  }), env, {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Stripe Identity could not start verification: Your Stripe account cannot create Identity verification sessions yet." });
});

test("identity sync refreshes a verified Stripe session into member status", async t => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_fingerprint: "fingerprint-1",
    identity_status: "pending_identity",
    stripe_identity_status: "requires_input",
    stripe_identity_session_id: "vs_sync_123"
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v1\/identity\/verification_sessions\/vs_sync_123$/);
    return new Response(JSON.stringify({ id: "vs_sync_123", status: "verified", metadata: { member_id: member.id } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const updates = [];
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("SELECT * FROM members WHERE id")) return member;
                if (sql.includes("identity_fingerprint")) return null;
                return null;
              },
              run: async () => {
                updates.push({ sql, args });
                return { success: true };
              }
            };
          }
        };
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/identity/sync", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: "{}"
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "verified", stripeStatus: "verified", verified: true });
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /stripe_identity_status='verified'/);
});
