const VERSION = "1.8.0";
const TIERS = [
  { threshold: 0, name: "Starter", reward: "Member access" },
  { threshold: 3, name: "Crew", reward: "Bonus discount" },
  { threshold: 10, name: "Breaker", reward: "Free shipping reward" },
  { threshold: 25, name: "Headliner", reward: "Crack Packs prize pack" },
  { threshold: 50, name: "Legend", reward: "VIP campaign grand prize entry" }
];
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalizeEmail = value => String(value || "").trim().toLowerCase().slice(0, 254);
const clean = (value, max = 64) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const randomString = (length, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join("");
async function hash(value, secret = "") {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${value}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function response(body, status = 200, cors = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } }); }
function corsFor(request, env) {
  const origin = request.headers.get("Origin"); const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim());
  if (!origin) return { "Access-Control-Allow-Origin": "*" };
  return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : null;
}
async function body(request) { try { return await request.json(); } catch { throw new Error("INVALID_JSON"); } }
async function sendEmail(env, to, subject, html, idempotencyKey = id()) {
  if (env.RESEND_API_KEY) {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        from: "Crack Packs Rewards <rewards@crackpacks.com>",
        to: [to],
        subject,
        html
      })
    });
    if (!result.ok) {
      const payload = await result.json().catch(() => ({}));
      console.error("Resend delivery failed", { status: result.status, name: payload.name || "", message: payload.message || "" });
      throw new Error("EMAIL_DELIVERY_FAILED");
    }
    return;
  }
  if (!env.REWARDS_EMAIL) {
    if (env.ENVIRONMENT === "development") return;
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const message = new EmailMessage("rewards@crackpacks.com", to, `From: Crack Packs Rewards <rewards@crackpacks.com>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`);
  await env.REWARDS_EMAIL.send(message);
}
async function memberFromRequest(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const tokenHash = await hash(token, env.AUTH_SECRET);
  return env.DB.prepare(`SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash, now()).first();
}
function account(member, count, env) {
  const tier = [...TIERS].reverse().find(t => count >= t.threshold);
  const next = TIERS.find(t => t.threshold > count);
  return {
    deviceVerified: Boolean(member.device_verified), profileComplete: member.identity_status === "verified", firstName: member.first_name,
    inviteCode: member.invite_code, inviteUrl: `${env.SITE_URL}/referral?ref=${member.invite_code}`,
    referralCount: count, tier, tiers: TIERS,
    nextTier: next ? { ...next, remaining: next.threshold - count } : null
  };
}
async function accountFor(member, env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) count FROM members WHERE referred_by_member_id=? AND referral_qualified_at IS NOT NULL AND identity_status='verified'`).bind(member.id).first();
  return account(member, Number(row?.count || 0), env);
}
async function audit(env, request, type, memberId = null, detail = "") {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  await env.DB.prepare(`INSERT INTO audit_events(id,member_id,type,ip_hash,detail,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), memberId, type, await hash(ip, env.AUTH_SECRET), detail.slice(0, 500), now()).run();
}
async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_NOT_CONFIGURED");
  const form = new FormData(); form.set("secret", env.TURNSTILE_SECRET_KEY); form.set("response", String(token || ""));
  form.set("remoteip", request.headers.get("CF-Connecting-IP") || "");
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const payload = await result.json();
  if (payload.success !== true) console.warn("Turnstile rejected request", { errorCodes: payload["error-codes"] || [], hostname: payload.hostname || "", action: payload.action || "" });
  return payload.success === true;
}
async function route(request, env, cors) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return response({ ok: true, service: "crackpacks-rewards", version: VERSION, identityMode: env.IDENTITY_MODE }, 200, cors);
  if (url.pathname === "/auth/request" && request.method === "POST") {
    const data = await body(request); const email = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Enter a valid email address." }, 400, cors);
    if (!await verifyTurnstile(env, data.turnstileToken, request)) return response({ error: "Security check failed. Refresh the page and try again." }, 403, cors);
    const recent = await env.DB.prepare(`SELECT COUNT(*) count FROM login_codes WHERE email=? AND created_at>?`).bind(email, new Date(Date.now() - 15 * 60e3).toISOString()).first();
    if (Number(recent.count) >= 3) return response({ error: "Too many codes requested. Try again later." }, 429, cors);
    const linkToken = randomString(48); const created = now();
    const ref = clean(data.referralCode, 16).toUpperCase();
    const verifyUrl = `${env.SITE_URL}/referral.html?verify=${encodeURIComponent(linkToken)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
    const codeId = id();
    await sendEmail(env, email, "Verify your Crack Packs email", `<h1>Verify your email</h1><p><a href="${verifyUrl}" style="display:inline-block;padding:14px 22px;background:#f8ff46;color:#070815;text-decoration:none;font-weight:bold;border-radius:10px">Verify email and continue</a></p><p>This secure link expires in 10 minutes and can only be used once. If you did not request it, ignore this message.</p>`, codeId);
    await env.DB.prepare(`INSERT INTO login_codes(id,email,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)`).bind(codeId, email, await hash(linkToken, env.AUTH_SECRET), new Date(Date.now() + 10 * 60e3).toISOString(), created).run();
    await audit(env, request, "login_code_requested", null, email); return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/auth/verify-link" && request.method === "POST") {
    const data = await body(request); const submittedHash = await hash(String(data.token || ""), env.AUTH_SECRET);
    const record = await env.DB.prepare(`SELECT * FROM login_codes WHERE code_hash=? AND used_at IS NULL LIMIT 1`).bind(submittedHash).first();
    if (!record || record.expires_at < now()) return response({ error: "That verification link is invalid or expired. Request a new email." }, 401, cors);
    const email = record.email;
    let member = await env.DB.prepare(`SELECT * FROM members WHERE email=?`).bind(email).first();
    if (!member) {
      let inviter = null; const ref = clean(data.referralCode, 16).toUpperCase();
      if (ref) inviter = await env.DB.prepare(`SELECT id,email FROM members WHERE invite_code=? AND identity_status='verified'`).bind(ref).first();
      const memberId = id(); const inviteCode = `CP${randomString(8)}`; const created = now();
      await env.DB.prepare(`INSERT INTO members(id,email,email_verified_at,invite_code,referred_by_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(memberId, email, created, inviteCode, inviter?.email !== email ? inviter?.id || null : null, created, created).run();
      member = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(memberId).first();
    }
    const token = randomString(48); await env.DB.batch([
      env.DB.prepare(`UPDATE login_codes SET used_at=? WHERE id=?`).bind(now(), record.id),
      env.DB.prepare(`INSERT INTO sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)`).bind(await hash(token, env.AUTH_SECRET), member.id, new Date(Date.now() + 30 * 86400e3).toISOString(), now())
    ]);
    await audit(env, request, "email_link_verified", member.id); return response({ token, account: await accountFor(member, env) }, 200, cors);
  }
  const member = await memberFromRequest(request, env);
  if (!member) return response({ error: "Sign in is required." }, 401, cors);
  if (url.pathname === "/me" && request.method === "GET") return response(await accountFor(member, env), 200, cors);
  if (url.pathname === "/device/register/options" && request.method === "POST") {
    const existing = await env.DB.prepare(`SELECT credential_id id, transports FROM webauthn_credentials WHERE member_id=?`).bind(member.id).all();
    const options = await generateRegistrationOptions({
      rpName: env.RP_NAME || "Crack Packs", rpID: env.RP_ID || "crackpacks.com",
      userName: member.email, userDisplayName: member.email.split("@")[0],
      attestationType: "none", authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      excludeCredentials: (existing.results || []).map(row => ({ id: row.id, transports: JSON.parse(row.transports || "[]") }))
    });
    await env.DB.prepare(`INSERT INTO security_challenges(id,member_id,purpose,challenge,expires_at,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), member.id, "passkey-registration", options.challenge, new Date(Date.now() + 5 * 60e3).toISOString(), now()).run();
    return response(options, 200, cors);
  }
  if (url.pathname === "/device/register/verify" && request.method === "POST") {
    const data = await body(request);
    const challenge = await env.DB.prepare(`SELECT * FROM security_challenges WHERE member_id=? AND purpose='passkey-registration' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1`).bind(member.id, now()).first();
    if (!challenge) return response({ error: "Device verification expired. Start again." }, 400, cors);
    const verification = await verifyRegistrationResponse({ response: data, expectedChallenge: challenge.challenge, expectedOrigin: env.SITE_URL, expectedRPID: env.RP_ID || "crackpacks.com", requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) return response({ error: "The passkey could not be verified." }, 401, cors);
    const info = verification.registrationInfo; const credential = info.credential;
    const duplicate = await env.DB.prepare(`SELECT member_id FROM webauthn_credentials WHERE credential_id=?`).bind(credential.id).first();
    if (duplicate && duplicate.member_id !== member.id) return response({ error: "That passkey is already connected to another account." }, 409, cors);
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO webauthn_credentials(credential_id,member_id,public_key,counter,transports,device_type,backed_up,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(credential.id, member.id, credential.publicKey, credential.counter, JSON.stringify(credential.transports || data.response?.transports || []), info.credentialDeviceType || "", info.credentialBackedUp ? 1 : 0, now()),
      env.DB.prepare(`UPDATE security_challenges SET used_at=? WHERE id=?`).bind(now(), challenge.id),
      env.DB.prepare(`UPDATE members SET device_verified=1,updated_at=? WHERE id=?`).bind(now(), member.id)
    ]);
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first(); await audit(env, request, "passkey_registered", member.id);
    return response({ account: await accountFor(updated, env) }, 200, cors);
  }
  if (!member.device_verified) return response({ error: "Verify a device passkey first." }, 403, cors);
  if (url.pathname === "/profile" && request.method === "POST") {
    const data = await body(request); const first = clean(data.firstName, 60), last = clean(data.lastName, 60), birth = clean(data.birthDate, 10), username = clean(data.whatnotUsername, 64).toLowerCase();
    if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(birth) || !/^[a-z0-9_.-]+$/.test(username) || data.consent !== "on") return response({ error: "Complete every identity field and consent checkbox." }, 400, cors);
    const age = (Date.now() - new Date(`${birth}T00:00:00Z`).getTime()) / 31557600000;
    if (age < 18 || age > 120) return response({ error: "Rewards accounts require a valid adult date of birth." }, 400, cors);
    const fingerprint = await hash(`${first.toLowerCase()}|${last.toLowerCase()}|${birth}`, env.IDENTITY_PEPPER || env.AUTH_SECRET);
    const duplicate = await env.DB.prepare(`SELECT id FROM members WHERE (identity_fingerprint=? OR whatnot_username=?) AND id<>?`).bind(fingerprint, username, member.id).first();
    if (duplicate) { await audit(env, request, "duplicate_identity_blocked", member.id); return response({ error: "This identity or Whatnot username is already connected to an account." }, 409, cors); }
    const identityStatus = "verified";
    await env.DB.prepare(`UPDATE members SET first_name=?,last_name=?,birth_date=?,whatnot_username=?,identity_fingerprint=?,identity_status=?,referral_qualified_at=?,updated_at=? WHERE id=?`).bind(first, last, birth, username, fingerprint, identityStatus, identityStatus === "verified" ? now() : null, now(), member.id).run();
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first(); await audit(env, request, "profile_submitted", member.id, identityStatus);
    return response({ account: await accountFor(updated, env) }, 200, cors);
  }
  if (member.identity_status !== "verified") return response({ error: "Complete identity verification first." }, 403, cors);
  if (url.pathname === "/invites" && request.method === "POST") {
    const data = await body(request); const invitee = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitee)) return response({ error: "Enter a valid friend email." }, 400, cors);
    if (invitee === member.email) return response({ error: "You cannot invite yourself." }, 400, cors);
    const existingMember = await env.DB.prepare(`SELECT id FROM members WHERE email=?`).bind(invitee).first();
    if (existingMember) return response({ error: "That email already belongs to a member." }, 409, cors);
    await env.DB.prepare(`INSERT OR IGNORE INTO invitations(id,inviter_member_id,invitee_email,created_at) VALUES(?,?,?,?)`).bind(id(), member.id, invitee, now()).run();
    const link = `${env.SITE_URL}/referral.html?ref=${member.invite_code}`;
    await sendEmail(env, invitee, `${member.first_name} invited you to Crack Packs`, `<h1>Join Crack Packs Rewards</h1><p>${member.first_name} invited you to join the collector community.</p><p><a href="${link}">Verify your email and join</a></p>`);
    await audit(env, request, "invite_sent", member.id, invitee); return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/discount/claim" && request.method === "POST") {
    let claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
    if (!claim) {
      const code = `${env.DISCOUNT_PREFIX || "CRACK"}-${randomString(8)}`, expires = new Date(Date.now() + 30 * 86400e3).toISOString();
      await env.DB.prepare(`INSERT INTO discount_claims(id,member_id,code,percent,expires_at,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), member.id, code, Number(env.DISCOUNT_PERCENT || 10), expires, now()).run();
      claim = { code, percent: Number(env.DISCOUNT_PERCENT || 10), expires_at: expires };
    }
    return response({ code: claim.code, expiresAt: claim.expires_at, redeemedAt: claim.redeemed_at || null, description: `${claim.percent}% off one eligible order.` }, 200, cors);
  }
  if (url.pathname === "/discount/redeem" && request.method === "POST") {
    const claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
    if (!claim) return response({ error: "Claim your discount code before redeeming it." }, 400, cors);
    if (claim.redeemed_at) return response({ error: "This discount code has already been redeemed." }, 409, cors);
    if (claim.expires_at <= now()) return response({ error: "This discount code has expired." }, 410, cors);
    const redeemedAt = now();
    const update = await env.DB.prepare(`UPDATE discount_claims SET redeemed_at=? WHERE id=? AND redeemed_at IS NULL`).bind(redeemedAt, claim.id).run();
    if (Number(update.meta?.changes || 0) !== 1) return response({ error: "This discount code has already been redeemed." }, 409, cors);
    const notifyEmail = normalizeEmail(env.DISCOUNT_NOTIFY_EMAIL || "hello@crackpacks.com");
    try {
      await sendEmail(
        env,
        notifyEmail,
        `Discount redeemed: ${claim.code}`,
        `<h1>Crack Packs discount redeemed</h1><p><strong>Code:</strong> ${escapeHtml(claim.code)}</p><p><strong>Discount:</strong> ${Number(claim.percent)}%</p><p><strong>Member:</strong> ${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</p><p><strong>Member email:</strong> ${escapeHtml(member.email)}</p><p><strong>Collector username:</strong> ${escapeHtml(member.whatnot_username || "Not provided")}</p><p><strong>Redeemed:</strong> ${escapeHtml(redeemedAt)}</p><p>This code has been permanently marked as used in the rewards database.</p>`,
        `discount-${claim.id}`
      );
      await audit(env, request, "discount_redeemed", member.id, claim.code);
    } catch (error) {
      console.error("Discount notification failed", error);
      await audit(env, request, "discount_redeemed_notification_failed", member.id, claim.code);
    }
    return response({ code: claim.code, redeemedAt, notificationEmail: notifyEmail }, 200, cors);
  }
  return response({ error: "Not found." }, 404, cors);
}
export default { async fetch(request, env) {
  const cors = corsFor(request, env); if (!cors) return response({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try { return await route(request, env, cors); } catch (error) { console.error(error); return response({ error: error.message === "INVALID_JSON" ? "Invalid request body." : "The rewards service encountered an error." }, 500, cors); }
}};
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { EmailMessage } from "cloudflare:email";
