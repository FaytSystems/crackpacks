import assert from "node:assert/strict";
import test from "node:test";
import { chooseBestRecordingForSession, handlePlatformRoute, hasEmployeePortalAccess, hasMasterPortalAccess, hasSellerPortalAccess, hasVerifiedSellerIdentity, isMasterEmail, usernameKey } from "../src/platform-routes.js";

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

test("employee access requires the full identity gate and an active employee profile", () => {
  const complete = {
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified"
  };
  assert.equal(hasEmployeePortalAccess(complete, { status: "active" }), true);
  assert.equal(hasEmployeePortalAccess({ ...complete, stripe_identity_status: "processing" }, { status: "active" }), false);
  assert.equal(hasEmployeePortalAccess(complete, { status: "suspended" }), false);
  assert.equal(hasEmployeePortalAccess(complete, { status: "terminated" }), false);
  assert.equal(hasEmployeePortalAccess(complete, null), false);
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

test("master portal mode keeps the constrained D1 value schema-safe", async () => {
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    active_portal: "buyer"
  };
  const updates = [];
  const env = {
    AUTH_SECRET: "test-secret",
    MASTER_EMAILS: "robertreese@faytsystems.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("breaker_profiles")) return null;
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
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/portal/mode", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ mode: "master" })
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { activePortal: "master" });
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE members SET active_portal/);
  assert.equal(updates[0].args[0], "buyer");
  assert.notEqual(updates[0].args[0], "master");
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

  const employee = await handlePlatformRoute(request({ force: true, returnTo: "employee" }), env, {});
  assert.equal(employee.status, 201);
  assert.match(stripeCalls[1].body, /metadata%5Breturn_to%5D=employee/);
  assert.match(stripeCalls[1].body, /return_url=https%3A%2F%2Fcrackpacks\.com%2Freferral\.html%3Fidentity%3Dreturn%26return%3Demployee/);
  assert.equal(updates.length, 2);
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
  assert.deepEqual(await response.json(), { status: "verified", stripeStatus: "verified", verified: true, resultEmailStatus: "", resultEmailSentAt: null });
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /stripe_identity_status='verified'/);
});

test("identity sync does not send accepted email before seller portal access", async t => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_fingerprint: "fingerprint-1",
    identity_status: "pending_identity",
    stripe_identity_status: "requires_input",
    stripe_identity_session_id: "vs_pass_123",
    stripe_identity_result_email_status: ""
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v1\/identity\/verification_sessions\/vs_pass_123$/);
    return new Response(JSON.stringify({ id: "vs_pass_123", status: "verified", metadata: { member_id: member.id } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const emails = [];
  const updates = [];
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    SITE_URL: "https://crackpacks.com",
    REWARDS_EMAIL: {
      send: async payload => {
        emails.push(payload);
        return { messageId: "email-pass" };
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("SELECT * FROM members WHERE id")) return member;
                if (sql.includes("identity_fingerprint=?")) return null;
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
    body: JSON.stringify({ notify: true })
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "verified", stripeStatus: "verified", verified: true, resultEmailStatus: "", resultEmailSentAt: null });
  assert.equal(emails.length, 0);
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /stripe_identity_status='verified'/);
});

test("seller portal activation sends accepted email with complete setup button", async () => {
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_status: "verified",
    stripe_identity_status: "verified",
    stripe_identity_result_email_status: "",
    live_username: "GARAGESALEdotcom",
    active_portal: "buyer"
  };
  const updatedMember = { ...member, active_portal: "seller" };
  const emails = [];
  const updates = [];
  const batches = [];
  const env = {
    AUTH_SECRET: "test-secret",
    SITE_URL: "https://crackpacks.com",
    REWARDS_EMAIL: {
      send: async payload => {
        emails.push(payload);
        return { messageId: "email-pass" };
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("SELECT * FROM members WHERE id")) return updatedMember;
                return null;
              },
              all: async () => ({ results: [] }),
              run: async () => {
                updates.push({ sql, args });
                return { success: true };
              }
            };
          }
        };
      },
      batch: async statements => {
        batches.push(statements);
        return statements.map(() => ({ success: true }));
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/profile/live-username", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ liveUsername: "GARAGESALEdotcom", activateSeller: true })
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { liveUsername: "GARAGESALEdotcom", sellerActivated: true, activePortal: "seller" });
  assert.equal(batches.length, 1);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Crack Packs ID verification accepted");
  assert.match(emails[0].html, /COMPLETE ACCOUNT SET-UP/);
  assert.match(emails[0].text, /email or User ID and password/);
  assert.match(updates.at(-1).sql, /stripe_identity_result_email_status/);
  assert.equal(updates.at(-1).args[0], "verified");
});

test("identity sync sends retry email when explicit status check fails", async t => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_fingerprint: "fingerprint-1",
    identity_status: "pending_identity",
    stripe_identity_status: "processing",
    stripe_identity_session_id: "vs_fail_123",
    stripe_identity_result_email_status: ""
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v1\/identity\/verification_sessions\/vs_fail_123$/);
    return new Response(JSON.stringify({ id: "vs_fail_123", status: "requires_input", metadata: { member_id: member.id } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const emails = [];
  const updates = [];
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    SITE_URL: "https://crackpacks.com",
    REWARDS_EMAIL: {
      send: async payload => {
        emails.push(payload);
        return { messageId: "email-fail" };
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("SELECT * FROM members WHERE id")) return member;
                if (sql.includes("SELECT stripe_identity_result_email_status")) {
                  const emailUpdate = updates.find(update => update.args?.[0] === "failed");
                  return emailUpdate ? { stripe_identity_result_email_status: "failed", stripe_identity_result_email_sent_at: emailUpdate.args[1] } : null;
                }
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
    body: JSON.stringify({ notify: true })
  }), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "requires_input");
  assert.equal(payload.stripeStatus, "requires_input");
  assert.equal(payload.verified, false);
  assert.equal(payload.resultEmailStatus, "failed");
  assert.ok(payload.resultEmailSentAt);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Crack Packs ID verification needs another try");
  assert.match(emails[0].html, /RETRY VERIFY ID/);
  assert.match(updates.at(-1).sql, /stripe_identity_result_email_status/);
  assert.equal(updates.at(-1).args[0], "failed");
});

test("identity retry email prefers Cloudflare Email when Resend is configured", async t => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_fingerprint: "fingerprint-1",
    identity_status: "pending_identity",
    stripe_identity_status: "processing",
    stripe_identity_session_id: "vs_resend_down_123",
    stripe_identity_result_email_status: ""
  };
  const stripeCalls = [];
  const resendCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes("/v1/identity/verification_sessions/")) {
      stripeCalls.push(requestUrl);
      return new Response(JSON.stringify({ id: "vs_resend_down_123", status: "requires_input", metadata: { member_id: member.id } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (requestUrl === "https://api.resend.com/emails") {
      resendCalls.push({ url: requestUrl, body: String(options.body || "") });
      return new Response(JSON.stringify({ name: "validation_error", message: "sender rejected" }), {
        status: 422,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch ${requestUrl}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const emails = [];
  const updates = [];
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    RESEND_API_KEY: "resend-test-key",
    SITE_URL: "https://crackpacks.com",
    REWARDS_EMAIL: {
      send: async payload => {
        emails.push(payload);
        return { messageId: "cloudflare-fallback" };
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("SELECT * FROM members WHERE id")) return member;
                if (sql.includes("SELECT stripe_identity_result_email_status")) {
                  const emailUpdate = updates.find(update => update.args?.[0] === "failed");
                  return emailUpdate ? { stripe_identity_result_email_status: "failed", stripe_identity_result_email_sent_at: emailUpdate.args[1] } : null;
                }
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
    body: JSON.stringify({ notify: true })
  }), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "requires_input");
  assert.equal(payload.resultEmailStatus, "failed");
  assert.equal(stripeCalls.length, 1);
  assert.equal(resendCalls.length, 0);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Crack Packs ID verification needs another try");
  assert.equal(emails[0].from.email, "rewards@crackpacks.com");
  assert.equal(emails[0].replyTo, "support@crackpacks.com");
  assert.match(updates.at(-1).sql, /stripe_identity_result_email_status/);
});

test("portal status syncs completed Stripe verification for older seller records", async t => {
  const originalFetch = globalThis.fetch;
  const initialMember = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email: "robertreese@faytsystems.com",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    first_name: "Robert",
    last_name: "Reese",
    birth_date: "1980-01-01",
    identity_fingerprint: "",
    identity_status: "verified",
    stripe_identity_status: "requires_input",
    stripe_identity_session_id: "vs_completed_123",
    live_username: "GARAGESALEdotcom",
    active_portal: "seller"
  };
  const verifiedMember = {
    ...initialMember,
    identity_fingerprint: "rebuilt-fingerprint",
    stripe_identity_status: "verified"
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v1\/identity\/verification_sessions\/vs_completed_123$/);
    return new Response(JSON.stringify({ id: "vs_completed_123", status: "verified", metadata: { member_id: initialMember.id } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const updates = [];
  let memberSelects = 0;
  const env = {
    AUTH_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_identity",
    MASTER_EMAILS: "robertreese@faytsystems.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return initialMember;
                if (sql.includes("SELECT * FROM members WHERE id")) {
                  memberSelects += 1;
                  return memberSelects > 1 ? verifiedMember : initialMember;
                }
                if (sql.includes("identity_fingerprint=?")) return null;
                if (sql.includes("breaker_profiles")) return { status: "active" };
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
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/portal/status", {
    method: "GET",
    headers: { Authorization: "Bearer session-token" }
  }), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sellerAccess, true);
  assert.equal(payload.activePortal, "seller");
  assert.equal(payload.sellerStatus, "active");
  assert.equal(payload.identityStatus, "verified");
  assert.equal(payload.stripeIdentityStatus, "verified");
  assert.equal(payload.sellerUsername, "GARAGESALEdotcom");
  assert.equal(payload.hasSellerLegalProfile, true);
  assert.equal(payload.isMaster, true);
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /identity_fingerprint=\?/);
  assert.match(String(updates[0].args[0]), /^[a-f0-9]{64}$/);
});

test("seller stream input creates Cloudflare live input with current API body", async t => {
  const originalFetch = globalThis.fetch;
  const cloudflareCalls = [];
  globalThis.fetch = async (url, options) => {
    cloudflareCalls.push({ url: String(url), method: options?.method || "GET", headers: options?.headers || {}, body: String(options?.body || "") });
    if (String(url).endsWith("/stream/live_inputs") && options?.method === "POST") {
      return new Response(JSON.stringify({
        success: true,
        result: {
          uid: "live_input_123",
          rtmps: { url: "rtmps://live.cloudflare.com:443/live/", streamKey: "secret-stream-key" },
          srt: { url: "srt://live.cloudflare.com:778", streamId: "live_input_123", passphrase: "secret-srt" }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/stream/live_inputs/live_input_123") && options?.method === "PUT") {
      return new Response(JSON.stringify({ success: true, result: { uid: "live_input_123" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "unexpected request" }] }), { status: 400, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "GARAGESALEdotcom"
  };
  let savedInput = null;
  const env = {
    AUTH_SECRET: "test-secret",
    CLOUDFLARE_ACCOUNT_ID: "198a4ebd4ac3a23957f8d0431c273228",
    CLOUDFLARE_STREAM_API_TOKEN: "Bearer stream-token",
    CLOUDFLARE_STREAM_CUSTOMER_CODE: "customer-test.cloudflarestream.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("breaker_profiles")) return { status: "active" };
                if (sql.includes("breaker_stream_inputs")) return savedInput;
                return null;
              },
              run: async () => {
                if (sql.includes("INSERT INTO breaker_stream_inputs")) {
                  savedInput = {
                    member_id: args[0],
                    cloudflare_live_input_uid: args[1],
                    rtmps_url: args[2],
                    rtmps_stream_key: args[3],
                    srt_url: args[4],
                    srt_stream_id: args[5],
                    srt_passphrase: args[6],
                    status: "disabled"
                  };
                }
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/seller/stream/input", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: "{}"
  }), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.input.uid, "live_input_123");
  assert.equal(payload.input.rtmpsUrl, "rtmps://live.cloudflare.com:443/live/");
  assert.equal(payload.input.streamKey, "secret-stream-key");
  assert.equal(payload.input.playbackUrl, "https://customer-test.cloudflarestream.com/live_input_123/iframe?autoplay=true&muted=true");
  assert.equal(cloudflareCalls.length, 2);
  const createBody = JSON.parse(cloudflareCalls[0].body);
  assert.equal(cloudflareCalls[0].headers.Authorization, "Bearer stream-token");
  assert.equal(cloudflareCalls[1].headers.Authorization, "Bearer stream-token");
  assert.equal(createBody.deleteRecordingAfterDays, 45);
  assert.equal(createBody.enabled, true);
  assert.equal(createBody.preferLowLatency, true);
  assert.equal(createBody.meta.name, "GARAGESALEdotcom Crack Packs input");
  assert.deepEqual(createBody.recording, {
    hideLiveViewerCount: false,
    mode: "automatic",
    requireSignedURLs: false,
    timeoutSeconds: 0
  });
});

test("seller stream input explains verified Cloudflare token with blocked Stream account request", async t => {
  const originalFetch = globalThis.fetch;
  const cloudflareCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    cloudflareCalls.push({ url: String(url), method: options.method || "GET", headers: options.headers || {}, body: String(options.body || "") });
    if (String(url).endsWith("/user/tokens/verify")) {
      return new Response(JSON.stringify({ success: true, result: { status: "active" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("", { status: 400, statusText: "Bad Request" });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "GARAGESALEdotcom"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    CLOUDFLARE_ACCOUNT_ID: "accounts/198a4ebd4ac3a23957f8d0431c273228",
    CLOUDFLARE_STREAM_API_TOKEN: "Bearer stream-token",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("breaker_profiles")) return { status: "active" };
                if (sql.includes("breaker_stream_inputs")) return null;
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/seller/stream/input", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: "{}"
  }), env, {});
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /Cloudflare rejected both supported live-input request formats/);
  assert.match(payload.error, /Cloudflare token verifies/);
  assert.match(payload.error, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(payload.error, /Stream is enabled\/subscribed/);
  assert.ok(cloudflareCalls.some(call => call.url.endsWith("/user/tokens/verify")));
  assert.equal(cloudflareCalls[0].headers.Authorization, "Bearer stream-token");
});

test("seller stream input verifies account-owned Cloudflare tokens", async t => {
  const originalFetch = globalThis.fetch;
  const cloudflareCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    cloudflareCalls.push({ url: String(url), method: options.method || "GET", headers: options.headers || {}, body: String(options.body || "") });
    if (String(url).endsWith("/accounts/198a4ebd4ac3a23957f8d0431c273228/tokens/verify")) {
      return new Response(JSON.stringify({ success: true, result: { status: "active" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("", { status: 400, statusText: "Bad Request" });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const member = {
    id: "db319ec3-aa9a-436a-a094-2fca08c85f8a",
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "GARAGESALEdotcom"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    CLOUDFLARE_ACCOUNT_ID: "198a4ebd4ac3a23957f8d0431c273228",
    CLOUDFLARE_STREAM_API_TOKEN: "cfat_stream-token",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("JOIN members")) return member;
                if (sql.includes("breaker_profiles")) return { status: "active" };
                if (sql.includes("breaker_stream_inputs")) return null;
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      }
    }
  };
  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/seller/stream/input", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: "{}"
  }), env, {});
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /Cloudflare token verifies/);
  assert.ok(cloudflareCalls.some(call => call.url.endsWith("/accounts/198a4ebd4ac3a23957f8d0431c273228/tokens/verify")));
  assert.ok(!cloudflareCalls.some(call => call.url.endsWith("/user/tokens/verify")));
  assert.equal(cloudflareCalls.at(-1).headers.Authorization, "Bearer cfat_stream-token");
});

test("live show list includes the featured item and its starting bid", async () => {
  const showId = "22222222-2222-4222-8222-222222222222";
  const lotId = "33333333-3333-4333-8333-333333333333";
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              all: async () => {
                assert.match(sql, /LEFT JOIN breaker_auction_lots featured_lot/);
                assert.equal(args.length, 3);
                return {
                  results: [{
                    id: showId,
                    seller_member_id: "11111111-1111-4111-8111-111111111111",
                    live_username: "ShowBuilder",
                    title: "Sunday Slabs",
                    status: "open",
                    viewer_count: 0,
                    thumbnail_url: "https://images.example.test/show.jpg",
                    scheduled_at: "2026-07-27T20:00:00.000Z",
                    saved: 0,
                    followed: 0,
                    featured_lot_id: lotId,
                    featured_lot_title: "Japanese Charizard",
                    featured_lot_status: "scheduled",
                    featured_lot_starting_bid_cents: 500,
                    featured_lot_current_bid_cents: null,
                    featured_lot_image_url: "https://images.example.test/charizard.jpg",
                    featured_lot_condition: "Near Mint"
                  }]
                };
              }
            };
          }
        };
      }
    }
  };

  const response = await handlePlatformRoute(new Request("https://api.crackpacks.test/live/shows"), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.shows.length, 1);
  assert.equal(payload.shows[0].title, "Sunday Slabs");
  assert.equal(payload.shows[0].state, "upcoming");
  assert.equal(payload.shows[0].image, "https://images.example.test/show.jpg");
  assert.equal(payload.shows[0].featuredLot.title, "Japanese Charizard");
  assert.equal(payload.shows[0].featuredLot.startingBidCents, 500);
  assert.equal(payload.shows[0].featuredLot.currentBidCents, null);
});

test("dedicated live show endpoint returns its thumbnail and first queued item", async () => {
  const showId = "22222222-2222-4222-8222-222222222222";
  const lotId = "33333333-3333-4333-8333-333333333333";
  const env = {
    CLOUDFLARE_STREAM_CUSTOMER_CODE: "customer-test.cloudflarestream.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("FROM breaker_auction_lots lot")) {
                  assert.equal(args[0], showId);
                  assert.equal(args[1], showId);
                  assert.equal(args[3], showId);
                  return {
                    id: lotId,
                    session_id: showId,
                    member_id: "11111111-1111-4111-8111-111111111111",
                    title: "Japanese Charizard",
                    description: "Near Mint card",
                    status: "scheduled",
                    starting_bid_cents: 500,
                    bid_increment_cents: 100,
                    current_bid_cents: null,
                    image_url: "https://images.example.test/charizard.jpg",
                    item_condition: "Near Mint",
                    sale_type: "cards",
                    viewer_count: 0,
                    cloudflare_live_input_uid: "stream-input-123"
                  };
                }
                if (sql.includes("FROM breaker_stream_sessions")) {
                  assert.deepEqual(args, [showId]);
                  return {
                    id: showId,
                    title: "Sunday Slabs",
                    status: "open",
                    viewer_count: 0,
                    cloudflare_live_input_uid: "stream-input-123",
                    thumbnail_url: "https://images.example.test/show.jpg",
                    scheduled_at: "2026-07-27T20:00:00.000Z",
                    started_at: "2026-07-27T20:00:00.000Z"
                  };
                }
                return null;
              }
            };
          }
        };
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/live/auction?show=${showId}`), env, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.show.title, "Sunday Slabs");
  assert.equal(payload.show.status, "open");
  assert.equal(payload.show.imageUrl, "https://images.example.test/show.jpg");
  assert.equal(payload.lot.title, "Japanese Charizard");
  assert.equal(payload.lot.status, "scheduled");
  assert.equal(payload.lot.startingBidCents, 500);
  assert.equal(payload.lot.bidIncrementCents, 100);
});

test("live show chat returns public User IDs without personal account details", async () => {
  const showId = "22222222-2222-4222-8222-222222222222";
  const sellerId = "11111111-1111-4111-8111-111111111111";
  const buyerId = "33333333-3333-4333-8333-333333333333";
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("SELECT id,member_id,status FROM breaker_stream_sessions")) {
                  assert.deepEqual(args, [showId]);
                  return { id: showId, member_id: sellerId, status: "live" };
                }
                return null;
              },
              all: async () => {
                assert.match(sql, /FROM live_show_chat_messages chat/);
                assert.deepEqual(args, [showId]);
                return {
                  results: [
                    {
                      id: "55555555-5555-4555-8555-555555555555",
                      show_id: showId,
                      member_id: buyerId,
                      display_username: "BuyerUser",
                      message: "Let us go!",
                      created_at: "2026-07-29T01:02:00.000Z",
                      is_seller: 0,
                      email: "private@example.test",
                      first_name: "Private"
                    },
                    {
                      id: "44444444-4444-4444-8444-444444444444",
                      show_id: showId,
                      member_id: sellerId,
                      display_username: "GARAGESALEdotcom",
                      message: "Welcome to the show.",
                      created_at: "2026-07-29T01:01:00.000Z",
                      is_seller: 1
                    }
                  ]
                };
              }
            };
          }
        };
      }
    }
  };

  const response = await handlePlatformRoute(
    new Request(`https://api.crackpacks.test/live/shows/${showId}/chat`),
    env,
    {}
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "live");
  assert.deepEqual(payload.messages.map(message => message.username), ["GARAGESALEdotcom", "BuyerUser"]);
  assert.equal(payload.messages[0].isSeller, true);
  assert.equal(payload.messages[1].isSeller, false);
  assert.doesNotMatch(JSON.stringify(payload), /private@example|Private/);
});

test("verified members can post a rate-limited live show chat message", async () => {
  const showId = "22222222-2222-4222-8222-222222222222";
  const memberId = "33333333-3333-4333-8333-333333333333";
  const writes = [];
  const member = {
    id: memberId,
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    buyer_username: "BuyerUser"
  };
  let recentMessage = null;
  const env = {
    AUTH_SECRET: "test-secret",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("SELECT id,member_id,status FROM breaker_stream_sessions")) {
                  return { id: showId, member_id: "11111111-1111-4111-8111-111111111111", status: "live" };
                }
                if (sql.includes("JOIN members m ON")) return member;
                if (sql.includes("SELECT created_at") && sql.includes("live_show_chat_messages")) return recentMessage;
                if (sql.includes("WHERE chat.id=?")) {
                  return {
                    id: args[0],
                    show_id: showId,
                    member_id: memberId,
                    display_username: "BuyerUser",
                    message: "Great pull!",
                    created_at: "2026-07-29T01:03:00.000Z",
                    is_seller: 0
                  };
                }
                return null;
              },
              run: async () => {
                writes.push({ sql, args });
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };

  const request = () => new Request(`https://api.crackpacks.test/live/shows/${showId}/chat`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ message: "Great pull!" })
  });
  const response = await handlePlatformRoute(request(), env, {});
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.message.username, "BuyerUser");
  assert.equal(payload.message.isOwn, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO live_show_chat_messages/);
  assert.equal(writes[0].args[1], showId);
  assert.equal(writes[0].args[2], memberId);
  assert.equal(writes[0].args[3], "Great pull!");

  recentMessage = { created_at: new Date(Date.now() - 250).toISOString() };
  const limited = await handlePlatformRoute(request(), env, {});
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /Wait a moment/);
  assert.equal(writes.length, 1);
});

test("seller can upload a JPEG thumbnail while creating a show", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const uploads = [];
  const writes = [];
  const member = {
    id: memberId,
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "ShowBuilder"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    SITE_URL: "https://crackpacks.com",
    SHOW_MEDIA: {
      put: async (key, value, options) => {
        uploads.push({ key, value: new Uint8Array(value), options });
        return { key };
      },
      delete: async () => {}
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes("JOIN members m")) return member;
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("FROM breaker_stream_inputs")) return { cloudflare_live_input_uid: "stream-input-123" };
                return null;
              },
              run: async () => {
                writes.push({ sql, args });
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
  const form = new FormData();
  form.set("title", "Uploaded Art Show");
  form.set("scheduledAt", "2026-07-28T20:00:00.000Z");
  form.set("thumbnailFile", new File([
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  ], "show.jpeg", { type: "image/jpeg" }));

  const response = await handlePlatformRoute(new Request("https://rewards-api.crackpacks.test/seller/shows", {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: form
  }), env, {});

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.thumbnailUrl, /^https:\/\/rewards-api\.crackpacks\.test\/media\/show-thumbnails\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].key, /^show-thumbnails\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(uploads[0].options.httpMetadata.contentType, "image/jpeg");
  assert.equal(uploads[0].options.customMetadata.memberId, memberId);
  const insert = writes.find(entry => entry.sql.includes("INSERT INTO breaker_stream_sessions"));
  assert.ok(insert);
  assert.equal(insert.args[10], payload.thumbnailUrl);
});

test("uploaded show thumbnail is served with immutable image headers", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const env = {
    SHOW_MEDIA: {
      get: async key => {
        assert.equal(key, `show-thumbnails/${memberId}/${showId}.png`);
        return {
          body: new Blob([imageBytes]).stream(),
          httpEtag: "\"show-etag\"",
          writeHttpMetadata(headers) {
            headers.set("Content-Type", "image/png");
          }
        };
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://rewards-api.crackpacks.test/media/show-thumbnails/${memberId}/${showId}.png`), env, {
    "Access-Control-Allow-Origin": "*"
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("ETag"), "\"show-etag\"");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), imageBytes);
});

test("seller can create numbered auctions from one personal-store listing", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  const listingId = "33333333-3333-4333-8333-333333333333";
  const member = {
    id: memberId,
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "ShowBuilder"
  };
  const batches = [];
  const env = {
    AUTH_SECRET: "test-secret",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              sql,
              args,
              first: async () => {
                if (sql.includes("JOIN members m")) return member;
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("SELECT id FROM breaker_stream_sessions")) return { id: showId };
                if (sql.includes("FROM seller_store_listings listing")) {
                  return {
                    id: listingId,
                    member_id: memberId,
                    title: "Japanese Charizard",
                    description: "Store inventory",
                    item_condition: "Near Mint",
                    image_url: "https://images.example.test/charizard.jpg",
                    sale_type: "cards",
                    quantity: 30,
                    status: "active",
                    linked_lot_status: ""
                  };
                }
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      },
      batch: async statements => {
        batches.push(statements);
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/lots`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ storeListingId: listingId, startingBid: 3, bidIncrement: 1, lotCount: 3, numberStart: 1 })
  }), env, {});

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.status, "scheduled");
  assert.equal(payload.storeListingId, listingId);
  assert.equal(payload.count, 3);
  assert.equal(payload.ids.length, 3);
  assert.match(payload.id, /^[0-9a-f-]{36}$/);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  assert.match(batches[0][0].sql, /INSERT INTO breaker_auction_lots/);
  assert.equal(batches[0][0].args[3], "Japanese Charizard #1");
  assert.equal(batches[0][0].args[5], 300);
  assert.equal(batches[0][1].args[3], "Japanese Charizard #2");
  assert.equal(batches[0][2].args[3], "Japanese Charizard #3");
  assert.match(batches[0][3].sql, /UPDATE seller_store_listings/);
  assert.equal(batches[0][3].args[0], showId);
  assert.equal(batches[0][3].args[3], listingId);
  assert.equal(batches[0][3].args[5], 3);

  const overAvailableResponse = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/lots`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ storeListingId: listingId, startingBid: 3, bidIncrement: 1, lotCount: 31, numberStart: 1 })
  }), env, {});
  assert.equal(overAvailableResponse.status, 409);
  assert.match((await overAvailableResponse.json()).error, /Only 30 units are available/);
  assert.equal(batches.length, 1);
});

test("seller cannot schedule store inventory already assigned to an active lot", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  const listingId = "33333333-3333-4333-8333-333333333333";
  let batchCalled = false;
  const env = {
    AUTH_SECRET: "test-secret",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("JOIN members m")) {
                  return {
                    id: memberId,
                    email_verified_at: "2026-07-24T00:00:00.000Z",
                    device_verified: 1,
                    identity_status: "verified",
                    stripe_identity_status: "verified",
                    live_username: "ShowBuilder"
                  };
                }
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("SELECT id FROM breaker_stream_sessions")) return { id: showId };
                if (sql.includes("FROM seller_store_listings listing")) {
                  return { id: listingId, member_id: memberId, title: "Already Scheduled", quantity: 1, status: "active", linked_lot_status: "scheduled" };
                }
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      },
      batch: async () => {
        batchCalled = true;
        return [];
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/lots`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ storeListingId: listingId, startingBid: 1, bidIncrement: 1 })
  }), env, {});

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already assigned/);
  assert.equal(batchCalled, false);
});

test("NEXT AUCTION settles the current lot and promotes a selected queued item", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  const currentLotId = "33333333-3333-4333-8333-333333333333";
  const nextLotId = "44444444-4444-4444-8444-444444444444";
  const batches = [];
  let scheduledQueryArgs = [];
  const member = {
    id: memberId,
    email_verified_at: "2026-07-24T00:00:00.000Z",
    device_verified: 1,
    identity_status: "verified",
    stripe_identity_status: "verified",
    live_username: "ShowBuilder"
  };
  const env = {
    AUTH_SECRET: "test-secret",
    LIVE_AUCTIONS_ENABLED: "true",
    CLOUDFLARE_STREAM_CUSTOMER_CODE: "customer.example.test",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              sql,
              args,
              first: async () => {
                if (sql.includes("JOIN members m")) return member;
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("SELECT id,title,status FROM breaker_stream_sessions")) {
                  return { id: showId, title: "Queue Test", status: "live" };
                }
                if (sql.includes("lot.member_id=? AND lot.status='live'")) {
                  return {
                    id: currentLotId,
                    session_id: showId,
                    member_id: memberId,
                    title: "Abyss Eye #1",
                    status: "live",
                    winning_member_id: "55555555-5555-4555-8555-555555555555",
                    winning_display: "TopBidder"
                  };
                }
                if (sql.includes("lot.status='scheduled'")) {
                  scheduledQueryArgs = args;
                  return {
                    id: nextLotId,
                    session_id: showId,
                    member_id: memberId,
                    title: "Abyss Eye #2",
                    status: "scheduled",
                    starting_bid_cents: 500,
                    bid_increment_cents: 100
                  };
                }
                if (sql.includes("WHERE lot.id=? AND lot.member_id=?")) {
                  return {
                    id: nextLotId,
                    session_id: showId,
                    member_id: memberId,
                    title: "Abyss Eye #2",
                    status: "live",
                    starting_bid_cents: 500,
                    bid_increment_cents: 100,
                    viewer_count: 12,
                    cloudflare_live_input_uid: "stream-input-123"
                  };
                }
                if (sql.includes("SELECT COUNT(*) queued")) return { queued: 2 };
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      },
      batch: async statements => {
        batches.push(statements);
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/auction-off`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ nextLotId })
  }), env, {});

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.closedLot.id, currentLotId);
  assert.equal(payload.closedLot.status, "sold");
  assert.equal(payload.lot.id, nextLotId);
  assert.equal(payload.lot.status, "live");
  assert.equal(payload.remainingQueued, 2);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  assert.match(batches[0][0].sql, /status=CASE WHEN winning_member_id IS NULL THEN 'cancelled' ELSE 'sold' END/);
  assert.match(batches[0][1].sql, /UPDATE breaker_auction_bids SET status='winning'/);
  assert.match(batches[0][2].sql, /SET status='live'/);
  assert.match(batches[0][2].sql, /closes_at=/);
  assert.equal(batches[0][2].args[3], nextLotId);
  assert.match(batches[0][3].sql, /UPDATE breaker_stream_sessions SET status='live'/);
  assert.deepEqual(scheduledQueryArgs.slice(2), [nextLotId, nextLotId]);
});

test("seller can save an exact Auction Block order", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  const lotIds = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555"
  ];
  const reordered = [lotIds[2], lotIds[0], lotIds[1]];
  let batchStatements = [];
  const env = {
    AUTH_SECRET: "test-secret",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              sql,
              args,
              first: async () => {
                if (sql.includes("JOIN members m")) {
                  return {
                    id: memberId,
                    email_verified_at: "2026-07-24T00:00:00.000Z",
                    device_verified: 1,
                    identity_status: "verified",
                    stripe_identity_status: "verified",
                    live_username: "ShowBuilder"
                  };
                }
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("SELECT id FROM breaker_stream_sessions")) return { id: showId };
                return null;
              },
              all: async () => sql.includes("SELECT id FROM breaker_auction_lots")
                ? { results: lotIds.map(id => ({ id })) }
                : { results: [] },
              run: async () => ({ success: true, meta: { changes: 1 } })
            };
          }
        };
      },
      batch: async statements => {
        batchStatements = statements;
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/lots/reorder`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: JSON.stringify({ lotIds: reordered })
  }), env, {});

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).lotIds, reordered);
  assert.equal(batchStatements.length, 3);
  assert.deepEqual(batchStatements.map(statement => statement.args[0]), [1, 2, 3]);
  assert.deepEqual(batchStatements.map(statement => statement.args[2]), reordered);
});

test("NEXT AUCTION refuses to finish a live lot when the queue is empty", async () => {
  const memberId = "11111111-1111-4111-8111-111111111111";
  const showId = "22222222-2222-4222-8222-222222222222";
  let batchCalled = false;
  const env = {
    AUTH_SECRET: "test-secret",
    LIVE_AUCTIONS_ENABLED: "true",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("JOIN members m")) {
                  return {
                    id: memberId,
                    email_verified_at: "2026-07-24T00:00:00.000Z",
                    device_verified: 1,
                    identity_status: "verified",
                    stripe_identity_status: "verified",
                    live_username: "ShowBuilder"
                  };
                }
                if (sql.includes("FROM breaker_profiles")) return { status: "active" };
                if (sql.includes("SELECT id,title,status FROM breaker_stream_sessions")) return { id: showId, title: "Queue Test", status: "live" };
                if (sql.includes("lot.member_id=? AND lot.status='live'")) return { id: "33333333-3333-4333-8333-333333333333", session_id: showId, status: "live" };
                if (sql.includes("lot.status='scheduled'")) return null;
                return null;
              }
            };
          }
        };
      },
      batch: async () => {
        batchCalled = true;
        return [];
      }
    }
  };

  const response = await handlePlatformRoute(new Request(`https://api.crackpacks.test/seller/shows/${showId}/auction-off`, {
    method: "POST",
    headers: { Authorization: "Bearer session-token" },
    body: "{}"
  }), env, {});

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /No queued item is ready/);
  assert.equal(batchCalled, false);
});
