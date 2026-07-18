import QRCode from "qrcode";
import { issueOwnerReferral, ownerReferralSlotAt, verifyOwnerReferral } from "./referral-rotation.js";
import { campaignWeekAt, parseCampaignExpiryHours } from "./campaign-time.js";

const VERSION = "2.6.0";
const CAMPAIGN_REWARD_TYPES = new Set(["percent", "free_shipping", "pick_a_pack", "pack_draft"]);
const MAX_CAMPAIGN_REDEMPTIONS = 500;
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
const boundedString = (value, max) => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" && value.length <= max ? value : null;
};
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const randomString = (length, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join("");
async function hash(value, secret = "") {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${value}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function response(body, status = 200, cors = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } }); }
function svgResponse(svg, cors = {}) { return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": "inline; filename=crack-packs-referral-qr.svg", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", ...cors } }); }
function corsFor(request, env) {
  const origin = request.headers.get("Origin"); const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim());
  if (!origin) return { "Access-Control-Allow-Origin": "*" };
  return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : null;
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
function isAdmin(member, env) {
  const adminEmail = normalizeEmail(env.ADMIN_EMAIL);
  return Boolean(adminEmail && member && normalizeEmail(member.email) === adminEmail && member.email_verified_at && member.device_verified && member.identity_status === "verified");
}
const isOwnerEmail = (member, env) => Boolean(member && normalizeEmail(env.ADMIN_EMAIL) && normalizeEmail(member.email) === normalizeEmail(env.ADMIN_EMAIL));
async function hasFreshAdminSession(request, member, env) {
  const adminToken = request.headers.get("X-Admin-Token") || "";
  if (!adminToken || !isAdmin(member, env)) return false;
  const row = await env.DB.prepare(`SELECT member_id FROM admin_sessions WHERE token_hash=? AND member_id=? AND expires_at>?`).bind(await hash(adminToken, env.AUTH_SECRET), member.id, now()).first();
  return Boolean(row);
}
async function inviteDetailsFor(member, env, epochMs = Date.now(), allowOwnerToken = false) {
  if (isOwnerEmail(member, env)) {
    if (!allowOwnerToken) {
      return {
        url: "",
        displayCode: "OWNER DASHBOARD",
        rotating: false,
        ownerDashboardOnly: true,
        startsAt: null,
        expiresAt: null,
        windowLabel: "Protected owner referral",
        nextBoundaryLabel: "",
        serverNow: new Date(epochMs).toISOString()
      };
    }
    const current = await issueOwnerReferral(env.SITE_URL, member.id, env.OWNER_REFERRAL_SECRET, epochMs);
    return {
      url: current.url,
      displayCode: "LIVE 12H",
      rotating: true,
      ownerDashboardOnly: false,
      startsAt: current.startsAt,
      expiresAt: current.expiresAt,
      windowLabel: current.label,
      nextBoundaryLabel: current.nextBoundaryLabel,
      serverNow: new Date(epochMs).toISOString()
    };
  }
  return {
    url: `${env.SITE_URL}/referral.html?ref=${member.invite_code}`,
    displayCode: member.invite_code,
    rotating: false,
    ownerDashboardOnly: false,
    startsAt: null,
    expiresAt: null,
    windowLabel: "No expiration",
    nextBoundaryLabel: "",
    serverNow: new Date(epochMs).toISOString()
  };
}
async function referralQrSvg(inviteUrl) {
  return QRCode.toString(inviteUrl, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 4,
    width: 1200,
    color: { dark: "#070815FF", light: "#FFFFFFFF" }
  });
}
const offerTokenValue = value => {
  const raw = boundedString(value, 64);
  if (!raw) return "";
  const normalized = raw.trim().toUpperCase();
  return /^OFR[A-HJ-NP-Z2-9]{32}$/.test(normalized) ? normalized : "";
};
const campaignUrl = (campaign, env) => `${env.SITE_URL}/referral.html?offer=${encodeURIComponent(campaign.offer_token)}`;
const campaignState = (campaign, redemptionCount, epochMs = Date.now()) => {
  if (Date.parse(campaign.expires_at) <= epochMs) return "expired";
  if (redemptionCount >= Number(campaign.max_redemptions)) return "full";
  return "active";
};
const availablePackNumbers = (campaign, redemptions) => {
  if (campaign.reward_type !== "pack_draft") return [];
  const taken = new Set(redemptions.map(row => Number(row.pack_number)).filter(Number.isInteger));
  return Array.from({ length: Number(campaign.pack_count) }, (_, index) => index + 1).filter(pack => !taken.has(pack));
};
function campaignRedemptionView(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    rewardType: row.reward_type,
    percent: row.percent === null || row.percent === undefined ? null : Number(row.percent),
    maxRedemptions: Number(row.max_redemptions),
    packCount: row.pack_count === null || row.pack_count === undefined ? null : Number(row.pack_count),
    campaignExpiresAt: row.expires_at,
    expiresAt: row.expires_at,
    code: row.code,
    rank: Number(row.claim_rank),
    claimRank: Number(row.claim_rank),
    packNumber: row.pack_number === null || row.pack_number === undefined ? null : Number(row.pack_number),
    pack: row.pack_number === null || row.pack_number === undefined ? null : Number(row.pack_number),
    claimedAt: row.claimed_at,
    redeemedAt: row.redeemed_at || null
  };
}
function campaignClaimPayload(row, alreadyClaimed, serverNow, week) {
  const redemption = campaignRedemptionView(row);
  return { alreadyClaimed, existing: alreadyClaimed, serverNow, week, redemption, claim: redemption };
}
function adminRedemptionView(row) {
  return {
    ...campaignRedemptionView(row),
    memberId: row.member_id,
    email: row.email,
    whatnotUsername: row.whatnot_username || ""
  };
}
function adminCampaignView(campaign, redemptions, env, epochMs = Date.now()) {
  const redemptionCount = redemptions.length;
  return {
    id: campaign.id,
    title: campaign.title,
    rewardType: campaign.reward_type,
    percent: campaign.percent === null || campaign.percent === undefined ? null : Number(campaign.percent),
    maxRedemptions: Number(campaign.max_redemptions),
    packCount: campaign.pack_count === null || campaign.pack_count === undefined ? null : Number(campaign.pack_count),
    offerToken: campaign.offer_token,
    url: campaignUrl(campaign, env),
    createdAt: campaign.created_at,
    expiresAt: campaign.expires_at,
    status: campaignState(campaign, redemptionCount, epochMs),
    claimedCount: redemptionCount,
    remaining: Math.max(0, Number(campaign.max_redemptions) - redemptionCount),
    redemptionCount,
    remainingRedemptions: Math.max(0, Number(campaign.max_redemptions) - redemptionCount),
    availablePackNumbers: availablePackNumbers(campaign, redemptions),
    redemptions: redemptions.map(adminRedemptionView)
  };
}
async function publicCampaignStatus(env, offerToken, epochMs = Date.now()) {
  const campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE offer_token=?`).bind(offerToken).first();
  if (!campaign) return { valid: false, status: "not_found", serverNow: new Date(epochMs).toISOString(), campaign: null };
  const rows = await env.DB.prepare(`SELECT pack_number FROM campaign_redemptions WHERE campaign_id=? ORDER BY claim_rank`).bind(campaign.id).all();
  const redemptions = rows.results || [];
  const redemptionCount = redemptions.length;
  const status = campaignState(campaign, redemptionCount, epochMs);
  return {
    valid: status === "active",
    status,
    serverNow: new Date(epochMs).toISOString(),
    campaign: {
      title: campaign.title,
      rewardType: campaign.reward_type,
      percent: campaign.percent === null || campaign.percent === undefined ? null : Number(campaign.percent),
      maxRedemptions: Number(campaign.max_redemptions),
      packCount: campaign.pack_count === null || campaign.pack_count === undefined ? null : Number(campaign.pack_count),
      expiresAt: campaign.expires_at,
      claimedCount: redemptionCount,
      remaining: Math.max(0, Number(campaign.max_redemptions) - redemptionCount),
      redemptionCount,
      remainingRedemptions: Math.max(0, Number(campaign.max_redemptions) - redemptionCount),
      availablePackNumbers: availablePackNumbers(campaign, redemptions)
    }
  };
}
async function weeklyReservation(env, memberId, week, sourceType, sourceId, createdAt) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO weekly_reward_claims(id,member_id,week_key,source_type,source_id,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), memberId, week.key, sourceType, sourceId, createdAt).run();
    if (Number(inserted.meta?.changes || 0) === 1) return { reserved: true };
    const existing = await env.DB.prepare(`SELECT * FROM weekly_reward_claims WHERE member_id=? AND week_key=?`).bind(memberId, week.key).first();
    if (!existing) continue;
    if (existing.source_type === sourceType && existing.source_id === sourceId) return { reserved: true };
    const linked = existing.source_type === "campaign"
      ? await env.DB.prepare(`SELECT id FROM campaign_redemptions WHERE id=?`).bind(existing.source_id).first()
      : await env.DB.prepare(`SELECT id FROM discount_claims WHERE id=?`).bind(existing.source_id).first();
    if (linked || Date.parse(existing.created_at) > Date.now() - 5 * 60e3) return { reserved: false, existing };
    await env.DB.prepare(`DELETE FROM weekly_reward_claims WHERE id=? AND source_id=?`).bind(existing.id, existing.source_id).run();
  }
  return { reserved: false };
}
async function releaseWeeklyReservation(env, memberId, weekKey, sourceType, sourceId) {
  await env.DB.prepare(`DELETE FROM weekly_reward_claims WHERE member_id=? AND week_key=? AND source_type=? AND source_id=?`).bind(memberId, weekKey, sourceType, sourceId).run();
}
async function account(member, count, env) {
  const tier = [...TIERS].reverse().find(t => count >= t.threshold);
  const next = TIERS.find(t => t.threshold > count);
  const invite = await inviteDetailsFor(member, env);
  return {
    deviceVerified: Boolean(member.device_verified), profileComplete: member.identity_status === "verified", firstName: member.first_name,
    whatnotUsername: member.whatnot_username || "", referredSignup: Boolean(member.referred_by_member_id), isAdmin: isAdmin(member, env),
    inviteCode: invite.ownerDashboardOnly ? "" : member.invite_code, inviteDisplayCode: invite.displayCode, inviteUrl: invite.url,
    rotatingReferral: invite.rotating, ownerReferralDashboardOnly: invite.ownerDashboardOnly,
    inviteStartsAt: invite.startsAt, inviteExpiresAt: invite.expiresAt,
    inviteWindowLabel: invite.windowLabel, inviteNextBoundaryLabel: invite.nextBoundaryLabel, serverNow: invite.serverNow,
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
async function route(request, env, cors, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return response({ ok: true, service: "crackpacks-rewards", version: VERSION, identityMode: env.IDENTITY_MODE }, 200, cors);
  if (url.pathname === "/referral/status" && request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 512) return response({ error: "Referral validation request is too large." }, 413, cors);
    const data = await body(request);
    const rawOwnerToken = boundedString(data?.ownerReferralToken, 80);
    const rawReferralCode = boundedString(data?.referralCode, 16);
    if (rawOwnerToken === null || rawReferralCode === null) return response({ error: "Invalid referral credential." }, 400, cors);
    const ownerToken = rawOwnerToken;
    const ref = rawReferralCode.trim().toUpperCase();
    if ((ownerToken && ref) || (ref && !/^[A-Z0-9]{1,16}$/.test(ref))) return response({ error: "Invalid referral credential." }, 400, cors);
    const epochMs = Date.now();
    const serverNow = new Date(epochMs).toISOString();
    if (ownerToken) {
      const owner = normalizeEmail(env.ADMIN_EMAIL) ? await env.DB.prepare(`SELECT id FROM members WHERE email=? AND identity_status='verified'`).bind(normalizeEmail(env.ADMIN_EMAIL)).first() : null;
      const slot = ownerReferralSlotAt(epochMs);
      const valid = Boolean(owner && await verifyOwnerReferral(ownerToken, env.SITE_URL, owner.id, env.OWNER_REFERRAL_SECRET, epochMs));
      return response({ valid, rotating: true, expiresAt: slot.expiresAt, windowLabel: slot.label, nextBoundaryLabel: slot.nextBoundaryLabel, serverNow, reason: valid ? "current" : "expired" }, 200, cors);
    }
    if (ref) {
      const inviter = await env.DB.prepare(`SELECT id,email,identity_status FROM members WHERE invite_code=?`).bind(ref).first();
      if (inviter && isOwnerEmail(inviter, env)) {
        const slot = ownerReferralSlotAt(epochMs);
        return response({ valid: false, rotating: true, expiresAt: slot.expiresAt, windowLabel: slot.label, nextBoundaryLabel: slot.nextBoundaryLabel, serverNow, reason: "owner_rotation_required" }, 200, cors);
      }
      const valid = inviter?.identity_status === "verified";
      return response({ valid, rotating: false, expiresAt: null, windowLabel: "No expiration", nextBoundaryLabel: "", serverNow, reason: valid ? "current" : "invalid" }, 200, cors);
    }
    return response({ valid: false, rotating: false, expiresAt: null, serverNow, reason: "missing" }, 200, cors);
  }
  if (url.pathname === "/campaign/status" && request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 512) return response({ error: "Campaign status request is too large." }, 413, cors);
    const data = await body(request);
    const offerToken = offerTokenValue(data?.offerToken);
    if (!offerToken) return response({ error: "Enter a valid offer token." }, 400, cors);
    return response(await publicCampaignStatus(env, offerToken, Date.now()), 200, cors);
  }
  if (url.pathname === "/auth/request" && request.method === "POST") {
    const data = await body(request); const email = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Enter a valid email address." }, 400, cors);
    const returnTo = data.returnTo === "admin" ? "admin" : "rewards";
    const authFlow = returnTo === "admin" ? "admin" : data.authMode === "signup" ? "signup" : "signin";
    if (!await verifyTurnstile(env, data.turnstileToken, request)) return response({ error: "Security check failed. Refresh the page and try again." }, 403, cors);
    const existingMember = await env.DB.prepare(`SELECT id FROM members WHERE email=?`).bind(email).first();
    const emailKey = await hash(email, env.AUTH_SECRET);
    const rateWindow = new Date(Date.now() - 15 * 60e3).toISOString();
    const recentCodes = await env.DB.prepare(`SELECT COUNT(*) count FROM login_codes WHERE email=? AND created_at>?`).bind(email, rateWindow).first();
    if (Number(recentCodes?.count || 0) >= 3) return response({ error: "Too many links requested. Try again later." }, 429, cors);
    const flowMatches = authFlow === "signup"
      ? !existingMember
      : authFlow === "admin"
        ? Boolean(existingMember) && email === normalizeEmail(env.ADMIN_EMAIL)
        : Boolean(existingMember);
    const linkToken = randomString(48); const created = now();
    const rawReferralCode = authFlow === "signup" ? boundedString(data.referralCode, 16) : "";
    const rawOwnerReferralToken = authFlow === "signup" ? boundedString(data.ownerReferralToken, 80) : "";
    if (rawReferralCode === null || rawOwnerReferralToken === null) return response({ error: "Invalid referral credential." }, 400, cors);
    const ref = rawReferralCode.trim().toUpperCase();
    const ownerReferralToken = rawOwnerReferralToken;
    if ((ownerReferralToken && ref) || (ref && !/^[A-Z0-9]{1,16}$/.test(ref))) return response({ error: "Invalid referral credential." }, 400, cors);
    let referrerMemberId = null;
    let ownerReferralRejected = false;
    if (ownerReferralToken) {
      const owner = normalizeEmail(env.ADMIN_EMAIL) ? await env.DB.prepare(`SELECT id,email FROM members WHERE email=? AND identity_status='verified'`).bind(normalizeEmail(env.ADMIN_EMAIL)).first() : null;
      if (owner && normalizeEmail(owner.email) !== email && await verifyOwnerReferral(ownerReferralToken, env.SITE_URL, owner.id, env.OWNER_REFERRAL_SECRET)) referrerMemberId = owner.id;
      else ownerReferralRejected = true;
    } else if (ref) {
      const inviter = await env.DB.prepare(`SELECT id,email,identity_status FROM members WHERE invite_code=?`).bind(ref).first();
      if (inviter && isOwnerEmail(inviter, env)) ownerReferralRejected = true;
      else if (inviter?.identity_status === "verified" && normalizeEmail(inviter.email) !== email) referrerMemberId = inviter.id;
    }
    if (ownerReferralRejected) return response({ error: "This owner referral window has expired. Ask for the current QR or referral link." }, 410, cors);
    const destinationPath = returnTo === "admin" ? "/admin.html" : "/referral.html";
    const verifyParams = new URLSearchParams({ verify: linkToken, mode: authFlow });
    if (authFlow !== "admin" && email !== normalizeEmail(env.ADMIN_EMAIL)) {
      const offerToken = offerTokenValue(data.offerToken);
      if (offerToken) {
        const offer = await env.DB.prepare(`SELECT id FROM offer_campaigns WHERE offer_token=?`).bind(offerToken).first();
        if (offer) verifyParams.set("offer", offerToken);
      }
    }
    const verifyUrl = `${env.SITE_URL}${destinationPath}?${verifyParams}`;
    const codeId = id();
    await env.DB.prepare(`INSERT INTO login_codes(id,email,code_hash,auth_flow,referrer_member_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?)`).bind(codeId, email, await hash(linkToken, env.AUTH_SECRET), authFlow, referrerMemberId, new Date(Date.now() + 10 * 60e3).toISOString(), created).run();
    const emailCopy = authFlow === "signup"
      ? { subject: "Create your Crack Packs account", heading: "Create your account", button: "Verify email and create account" }
      : { subject: "Sign in to your Crack Packs account", heading: "Sign in to your account", button: "Verify email and sign in" };
    const finishAuthRequest = async () => {
      if (!flowMatches) {
        await audit(env, request, "auth_flow_mismatch", null, emailKey);
        return;
      }
      try {
        await sendEmail(env, email, emailCopy.subject, `<h1>${emailCopy.heading}</h1><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:14px 22px;background:#f8ff46;color:#070815;text-decoration:none;font-weight:bold;border-radius:10px">${emailCopy.button}</a></p><p>This secure link expires in 10 minutes and can only be used once. If you did not request it, ignore this message.</p>`, codeId);
        await audit(env, request, `${authFlow}_link_requested`, null, emailKey);
      } catch (error) {
        console.error("Authentication email delivery failed", { flow: authFlow, codeId });
        await audit(env, request, "auth_email_delivery_failed", null, emailKey);
      }
    };
    if (ctx?.waitUntil) ctx.waitUntil(finishAuthRequest());
    else await finishAuthRequest();
    return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/auth/verify-link" && request.method === "POST") {
    const data = await body(request); const submittedHash = await hash(String(data.token || ""), env.AUTH_SECRET);
    const record = await env.DB.prepare(`SELECT * FROM login_codes WHERE code_hash=? AND used_at IS NULL LIMIT 1`).bind(submittedHash).first();
    if (!record || record.expires_at < now()) return response({ error: "That verification link is invalid or expired. Request a new email." }, 401, cors);
    const consumed = await env.DB.prepare(`UPDATE login_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?`).bind(now(), record.id, now()).run();
    if (Number(consumed.meta?.changes || 0) !== 1) return response({ error: "That verification link has already been used or expired." }, 409, cors);
    const email = record.email;
    const authFlow = ["signin", "signup", "admin"].includes(record.auth_flow) ? record.auth_flow : "legacy";
    let member = await env.DB.prepare(`SELECT * FROM members WHERE email=?`).bind(email).first();
    if (authFlow === "admin" && email !== normalizeEmail(env.ADMIN_EMAIL)) return response({ error: "Owner access required." }, 403, cors);
    if (authFlow !== "signup" && !member) return response({ error: "No account was found. Return to Profile and choose Create Account." }, 404, cors);
    if (authFlow === "signup" && member) return response({ error: "An account already exists for this email. Return to Profile and choose Sign In." }, 409, cors);
    if (authFlow === "signup") {
      let referrerMemberId = null;
      if (record.referrer_member_id) {
        const inviter = await env.DB.prepare(`SELECT id,email FROM members WHERE id=? AND identity_status='verified'`).bind(record.referrer_member_id).first();
        if (inviter && normalizeEmail(inviter.email) !== email) referrerMemberId = inviter.id;
      }
      const memberId = id(); const inviteCode = `CP${randomString(8)}`; const created = now();
      try {
        await env.DB.prepare(`INSERT INTO members(id,email,email_verified_at,invite_code,referred_by_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(memberId, email, created, inviteCode, referrerMemberId, created, created).run();
      } catch (error) {
        return response({ error: "An account already exists for this email. Return to Profile and choose Sign In." }, 409, cors);
      }
      member = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(memberId).first();
    }
    const token = randomString(48);
    await env.DB.prepare(`INSERT INTO sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)`).bind(await hash(token, env.AUTH_SECRET), member.id, new Date(Date.now() + 30 * 86400e3).toISOString(), now()).run();
    await audit(env, request, "email_link_verified", member.id, authFlow); return response({ token, authFlow, account: await accountFor(member, env) }, 200, cors);
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    const sessionToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (sessionToken) {
      const tokenHash = await hash(sessionToken, env.AUTH_SECRET);
      const session = await env.DB.prepare(`SELECT member_id FROM sessions WHERE token_hash=?`).bind(tokenHash).first();
      if (session) {
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM admin_sessions WHERE member_id=?`).bind(session.member_id),
          env.DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(tokenHash)
        ]);
      }
    }
    return response({ ok: true }, 200, cors);
  }
  const member = await memberFromRequest(request, env);
  if (!member) return response({ error: "Sign in is required." }, 401, cors);
  if (url.pathname === "/me" && request.method === "GET") return response(await accountFor(member, env), 200, cors);
  if (url.pathname === "/profile/referral/qr" && request.method === "POST") {
    if (!member.device_verified || member.identity_status !== "verified") return response({ error: "Complete account verification before generating a referral QR." }, 403, cors);
    if (isOwnerEmail(member, env)) return response({ error: "Owner referral links and QR codes are generated only in the protected Owner Dashboard." }, 403, cors);
    const data = await body(request);
    if (boundedString(data?.inviteUrl, 512) === null) return response({ error: "Invalid referral address." }, 400, cors);
    const invite = await inviteDetailsFor(member, env);
    if (String(data.inviteUrl || "") !== invite.url) return response({ error: "That referral window changed. Refresh the current link before generating its QR." }, 409, cors);
    return svgResponse(await referralQrSvg(invite.url), cors);
  }
  if (url.pathname === "/device/register/options" && request.method === "POST") {
    const existing = await env.DB.prepare(`SELECT credential_id id, transports FROM webauthn_credentials WHERE member_id=?`).bind(member.id).all();
    if (member.device_verified && (existing.results || []).length) return response({ error: "A passkey is already registered for this account. Contact support for secure recovery." }, 409, cors);
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
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: data, expectedChallenge: challenge.challenge, expectedOrigin: env.SITE_URL, expectedRPID: env.RP_ID || "crackpacks.com", requireUserVerification: true });
    } catch (error) {
      console.warn("Passkey registration rejected", { name: error?.name || "Error" });
      return response({ error: "The passkey could not be verified. Try the local device or Windows Hello option again." }, 401, cors);
    }
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
    if (member.identity_status === "verified") return response({ error: "Your identity profile is already verified. Use profile settings to update your WhatNot User Name." }, 409, cors);
    const data = await body(request); const first = clean(data.firstName, 60), last = clean(data.lastName, 60), birth = clean(data.birthDate, 10), username = clean(data.whatnotUsername, 64).toLowerCase();
    if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(birth) || !/^[a-z0-9_.-]+$/.test(username) || data.consent !== "on") return response({ error: "Complete every identity field and consent checkbox." }, 400, cors);
    const birthDate = new Date(`${birth}T00:00:00Z`);
    if (!Number.isFinite(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== birth) return response({ error: "Enter a valid calendar date of birth." }, 400, cors);
    const age = (Date.now() - birthDate.getTime()) / 31557600000;
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
  if (url.pathname === "/campaign/claim" && request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 512) return response({ error: "Campaign claim request is too large." }, 413, cors);
    const data = await body(request);
    const offerToken = offerTokenValue(data?.offerToken);
    if (!offerToken) return response({ error: "Enter a valid offer token." }, 400, cors);
    const epochMs = Date.now();
    const claimedAt = new Date(epochMs).toISOString();
    const week = campaignWeekAt(epochMs);
    const campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE offer_token=?`).bind(offerToken).first();
    if (!campaign) return response({ error: "Campaign offer not found." }, 404, cors);
    if (isOwnerEmail(member, env) || campaign.owner_member_id === member.id) return response({ error: "The owner account cannot claim its own public campaign rewards." }, 403, cors);
    const loadMemberClaim = () => env.DB.prepare(`
      SELECT cr.*,c.title,c.reward_type,c.percent,c.max_redemptions,c.pack_count,c.expires_at
      FROM campaign_redemptions cr JOIN offer_campaigns c ON c.id=cr.campaign_id
      WHERE cr.campaign_id=? AND cr.member_id=?
    `).bind(campaign.id, member.id).first();
    let existingClaim = await loadMemberClaim();
    if (existingClaim) return response(campaignClaimPayload(existingClaim, true, claimedAt, week), 200, cors);
    if (campaign.expires_at <= claimedAt) return response({ error: "This campaign has expired." }, 410, cors);
    let packNumber = null;
    if (campaign.reward_type === "pack_draft") {
      if (!Number.isInteger(data.packNumber) || data.packNumber < 1 || data.packNumber > Number(campaign.pack_count)) return response({ error: `Choose an available pack number from 1 to ${Number(campaign.pack_count)}.` }, 400, cors);
      packNumber = data.packNumber;
    } else if (data.packNumber !== undefined && data.packNumber !== null && data.packNumber !== "") {
      return response({ error: "Pack number is only used for pack draft campaigns." }, 400, cors);
    }
    const legacyThisWeek = await env.DB.prepare(`SELECT id FROM discount_claims WHERE member_id=? AND created_at>=? AND created_at<?`).bind(member.id, week.startsAt, week.expiresAt).first();
    if (legacyThisWeek) return response({ error: "A reward code was already issued to this account during the current Thursday-to-Wednesday week." }, 409, cors);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      existingClaim = await loadMemberClaim();
      if (existingClaim) return response(campaignClaimPayload(existingClaim, true, new Date().toISOString(), week), 200, cors);
      const otherCampaign = await env.DB.prepare(`SELECT id,campaign_id FROM campaign_redemptions WHERE member_id=? AND week_key=?`).bind(member.id, week.key).first();
      if (otherCampaign) return response({ error: "Another campaign reward was already claimed during the current Thursday-to-Wednesday week." }, 409, cors);
      if (packNumber !== null) {
        const chosenPack = await env.DB.prepare(`SELECT id FROM campaign_redemptions WHERE campaign_id=? AND pack_number=?`).bind(campaign.id, packNumber).first();
        if (chosenPack) return response({ error: "That pack number was already selected. Choose another available pack." }, 409, cors);
      }
      const redemptionId = id();
      const code = `CPR${randomString(12)}`;
      const reservation = await weeklyReservation(env, member.id, week, "campaign", redemptionId, claimedAt);
      if (!reservation.reserved) {
        existingClaim = await loadMemberClaim();
        if (existingClaim) return response(campaignClaimPayload(existingClaim, true, new Date().toISOString(), week), 200, cors);
        return response({ error: "A reward code was already issued to this account during the current Thursday-to-Wednesday week." }, 409, cors);
      }
      const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO campaign_redemptions(id,campaign_id,member_id,week_key,code,claim_rank,pack_number,claimed_at,redeemed_at,redeemed_by_member_id)
        SELECT ?,c.id,?,?,?,COALESCE((SELECT MAX(existing.claim_rank) FROM campaign_redemptions existing WHERE existing.campaign_id=c.id),0)+1,?,?,NULL,NULL
        FROM offer_campaigns c
        WHERE c.id=? AND c.owner_member_id<>? AND c.expires_at>?
          AND (SELECT COUNT(*) FROM campaign_redemptions capacity WHERE capacity.campaign_id=c.id) < c.max_redemptions
          AND (? IS NULL OR (c.reward_type='pack_draft' AND ? BETWEEN 1 AND c.pack_count AND NOT EXISTS (SELECT 1 FROM campaign_redemptions packs WHERE packs.campaign_id=c.id AND packs.pack_number=?)))
      `).bind(redemptionId, member.id, week.key, code, packNumber, claimedAt, campaign.id, member.id, claimedAt, packNumber, packNumber, packNumber).run();
      if (Number(inserted.meta?.changes || 0) === 1) {
        const claim = await env.DB.prepare(`
          SELECT cr.*,c.title,c.reward_type,c.percent,c.max_redemptions,c.pack_count,c.expires_at
          FROM campaign_redemptions cr JOIN offer_campaigns c ON c.id=cr.campaign_id WHERE cr.id=?
        `).bind(redemptionId).first();
        await audit(env, request, "campaign_reward_claimed", member.id, `${campaign.id}|${redemptionId}|rank:${claim.claim_rank}${packNumber === null ? "" : `|pack:${packNumber}`}`);
        return response(campaignClaimPayload(claim, false, new Date().toISOString(), week), 201, cors);
      }
      await releaseWeeklyReservation(env, member.id, week.key, "campaign", redemptionId);
      existingClaim = await loadMemberClaim();
      if (existingClaim) return response(campaignClaimPayload(existingClaim, true, new Date().toISOString(), week), 200, cors);
      const currentCount = await env.DB.prepare(`SELECT COUNT(*) count FROM campaign_redemptions WHERE campaign_id=?`).bind(campaign.id).first();
      if (Number(currentCount?.count || 0) >= Number(campaign.max_redemptions)) return response({ error: "This campaign has reached its redemption limit." }, 409, cors);
      if (campaign.expires_at <= now()) return response({ error: "This campaign has expired." }, 410, cors);
      if (packNumber !== null) {
        const chosenPack = await env.DB.prepare(`SELECT id FROM campaign_redemptions WHERE campaign_id=? AND pack_number=?`).bind(campaign.id, packNumber).first();
        if (chosenPack) return response({ error: "That pack number was already selected. Choose another available pack." }, 409, cors);
      }
    }
    return response({ error: "The campaign claim changed while it was being saved. Try again." }, 409, cors);
  }
  if (url.pathname === "/campaigns/mine" && request.method === "GET") {
    const [claimRows, legacyDiscount] = await Promise.all([
      env.DB.prepare(`
        SELECT cr.*,c.title,c.reward_type,c.percent,c.max_redemptions,c.pack_count,c.expires_at
        FROM campaign_redemptions cr JOIN offer_campaigns c ON c.id=cr.campaign_id
        WHERE cr.member_id=? ORDER BY cr.claimed_at DESC
      `).bind(member.id).all(),
      env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first()
    ]);
    const epochMs = Date.now();
    const campaignClaims = (claimRows.results || []).map(campaignRedemptionView);
    const legacyDiscountView = legacyDiscount ? {
      id: legacyDiscount.id,
      code: legacyDiscount.code,
      percent: Number(legacyDiscount.percent),
      expiresAt: legacyDiscount.expires_at,
      requestedAt: legacyDiscount.redemption_requested_at || null,
      redeemedAt: legacyDiscount.redeemed_at || null,
      createdAt: legacyDiscount.created_at
    } : null;
    const claims = campaignClaims.map(claim => ({ source: "campaign", ...claim }));
    if (legacyDiscountView) claims.push({
      source: "legacy_discount",
      id: legacyDiscountView.id,
      campaignId: null,
      title: "One-time member discount",
      rewardType: "percent",
      percent: legacyDiscountView.percent,
      maxRedemptions: null,
      packCount: null,
      campaignExpiresAt: legacyDiscountView.expiresAt,
      expiresAt: legacyDiscountView.expiresAt,
      code: legacyDiscountView.code,
      rank: null,
      packNumber: null,
      claimedAt: legacyDiscountView.createdAt,
      requestedAt: legacyDiscountView.requestedAt,
      redeemedAt: legacyDiscountView.redeemedAt
    });
    claims.sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt));
    return response({
      serverNow: new Date(epochMs).toISOString(),
      week: campaignWeekAt(epochMs),
      claims,
      campaignClaims,
      legacyDiscount: legacyDiscountView
    }, 200, cors);
  }
  if (url.pathname === "/profile/username" && request.method === "POST") {
    const data = await body(request);
    const username = clean(data.whatnotUsername, 64).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(username)) return response({ error: "Enter a valid WhatNot User Name using letters, numbers, dots, dashes, or underscores." }, 400, cors);
    const duplicate = await env.DB.prepare(`SELECT id FROM members WHERE whatnot_username=? AND id<>?`).bind(username, member.id).first();
    if (duplicate) return response({ error: "That WhatNot User Name is already connected to another account." }, 409, cors);
    await env.DB.prepare(`UPDATE members SET whatnot_username=?,updated_at=? WHERE id=?`).bind(username, now(), member.id).run();
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first();
    await audit(env, request, "whatnot_username_updated", member.id, username);
    return response({ account: await accountFor(updated, env) }, 200, cors);
  }
  if (url.pathname === "/admin/auth/options" && request.method === "POST") {
    if (!isAdmin(member, env)) return response({ error: "Owner access required." }, 403, cors);
    const credentials = await env.DB.prepare(`SELECT credential_id,transports FROM webauthn_credentials WHERE member_id=?`).bind(member.id).all();
    if (!(credentials.results || []).length) return response({ error: "Register your account passkey before opening the owner dashboard." }, 403, cors);
    const options = await generateAuthenticationOptions({
      rpID: env.RP_ID || "crackpacks.com",
      userVerification: "required",
      allowCredentials: credentials.results.map(row => ({ id: row.credential_id, transports: JSON.parse(row.transports || "[]") }))
    });
    await env.DB.prepare(`INSERT INTO security_challenges(id,member_id,purpose,challenge,expires_at,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), member.id, "admin-authentication", options.challenge, new Date(Date.now() + 5 * 60e3).toISOString(), now()).run();
    return response(options, 200, cors);
  }
  if (url.pathname === "/admin/auth/verify" && request.method === "POST") {
    if (!isAdmin(member, env)) return response({ error: "Owner access required." }, 403, cors);
    const data = await body(request);
    const challenge = await env.DB.prepare(`SELECT * FROM security_challenges WHERE member_id=? AND purpose='admin-authentication' AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1`).bind(member.id, now()).first();
    if (!challenge) return response({ error: "Owner verification expired. Start again." }, 400, cors);
    const credential = await env.DB.prepare(`SELECT * FROM webauthn_credentials WHERE credential_id=? AND member_id=?`).bind(String(data.id || ""), member.id).first();
    if (!credential) return response({ error: "That passkey is not registered to the owner account." }, 401, cors);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: data,
        expectedChallenge: challenge.challenge,
        expectedOrigin: env.SITE_URL,
        expectedRPID: env.RP_ID || "crackpacks.com",
        credential: {
          id: credential.credential_id,
          publicKey: new Uint8Array(credential.public_key),
          counter: Number(credential.counter || 0),
          transports: JSON.parse(credential.transports || "[]")
        },
        requireUserVerification: true
      });
    } catch (error) {
      console.warn("Owner passkey assertion rejected", { name: error?.name || "Error" });
      return response({ error: "Owner passkey verification failed. Try again with the registered passkey." }, 401, cors);
    }
    if (!verification.verified) return response({ error: "Owner passkey verification failed." }, 401, cors);
    const consumed = await env.DB.prepare(`UPDATE security_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?`).bind(now(), challenge.id, now()).run();
    if (Number(consumed.meta?.changes || 0) !== 1) return response({ error: "Owner verification was already used. Start again." }, 409, cors);
    const adminToken = randomString(48); const created = now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE webauthn_credentials SET counter=?,last_used_at=? WHERE credential_id=?`).bind(verification.authenticationInfo.newCounter, created, credential.credential_id),
      env.DB.prepare(`INSERT INTO admin_sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)`).bind(await hash(adminToken, env.AUTH_SECRET), member.id, new Date(Date.now() + 2 * 60 * 60e3).toISOString(), created)
    ]);
    await audit(env, request, "admin_step_up_verified", member.id);
    return response({ adminToken, expiresAt: new Date(Date.now() + 2 * 60 * 60e3).toISOString() }, 200, cors);
  }
  if (url.pathname === "/admin/logout" && request.method === "POST") {
    const adminToken = request.headers.get("X-Admin-Token") || "";
    if (adminToken) await env.DB.prepare(`DELETE FROM admin_sessions WHERE token_hash=?`).bind(await hash(adminToken, env.AUTH_SECRET)).run();
    return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/admin/referral/current" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    return response(await inviteDetailsFor(member, env, Date.now(), true), 200, cors);
  }
  if (url.pathname === "/admin/referral/qr" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    if (boundedString(data?.inviteUrl, 512) === null) return response({ error: "Invalid referral address." }, 400, cors);
    const invite = await inviteDetailsFor(member, env, Date.now(), true);
    if (String(data.inviteUrl || "") !== invite.url) return response({ error: "That referral window changed. Refresh the current link before generating its QR." }, 409, cors);
    return svgResponse(await referralQrSvg(invite.url), cors);
  }
  if (url.pathname === "/admin/campaigns" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 2048) return response({ error: "Campaign request is too large." }, 413, cors);
    const data = await body(request);
    const rawTitle = boundedString(data?.title, 100);
    const rawRewardType = boundedString(data?.rewardType, 32);
    const title = rawTitle === null ? "" : clean(rawTitle, 100);
    const rewardType = rawRewardType || "";
    const expiresInHours = parseCampaignExpiryHours(data?.expiresInHours);
    const maxRedemptions = data?.maxRedemptions;
    if (!title) return response({ error: "Enter a campaign title up to 100 characters." }, 400, cors);
    if (!CAMPAIGN_REWARD_TYPES.has(rewardType)) return response({ error: "Choose a valid campaign reward type." }, 400, cors);
    if (expiresInHours === null) return response({ error: "Campaign expiration must be between 1 hour and 7 days." }, 400, cors);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > MAX_CAMPAIGN_REDEMPTIONS) return response({ error: `Maximum redemptions must be from 1 to ${MAX_CAMPAIGN_REDEMPTIONS}.` }, 400, cors);
    let percent = null;
    let packCount = null;
    if (rewardType === "percent") {
      if (!Number.isInteger(data.percent) || data.percent < 1 || data.percent > 100) return response({ error: "Percent rewards require a whole number from 1 to 100." }, 400, cors);
      if (data.packCount !== undefined && data.packCount !== null && data.packCount !== "") return response({ error: "Pack count is only used for pack draft campaigns." }, 400, cors);
      percent = data.percent;
    } else {
      if (data.percent !== undefined && data.percent !== null && data.percent !== "") return response({ error: "Percent is only used for percent campaigns." }, 400, cors);
      if (rewardType === "pack_draft") {
        if (!Number.isInteger(data.packCount) || data.packCount < maxRedemptions || data.packCount > MAX_CAMPAIGN_REDEMPTIONS) return response({ error: `Pack draft count must be at least the redemption limit and no more than ${MAX_CAMPAIGN_REDEMPTIONS}.` }, 400, cors);
        packCount = data.packCount;
      } else if (data.packCount !== undefined && data.packCount !== null && data.packCount !== "") {
        return response({ error: "Pack count is only used for pack draft campaigns." }, 400, cors);
      }
    }
    const epochMs = Date.now();
    const createdAt = new Date(epochMs).toISOString();
    const expiresAt = new Date(epochMs + Math.round(expiresInHours * 3600e3)).toISOString();
    let campaign = null;
    for (let attempt = 0; attempt < 5 && !campaign; attempt += 1) {
      const campaignId = id();
      const offerToken = `OFR${randomString(32)}`;
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO offer_campaigns(id,owner_member_id,title,reward_type,percent,max_redemptions,pack_count,offer_token,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(campaignId, member.id, title, rewardType, percent, maxRedemptions, packCount, offerToken, expiresAt, createdAt).run();
      if (Number(inserted.meta?.changes || 0) === 1) campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE id=?`).bind(campaignId).first();
    }
    if (!campaign) return response({ error: "The campaign could not be created. Try again." }, 503, cors);
    await audit(env, request, "campaign_created", member.id, `${campaign.id}|${rewardType}|max:${maxRedemptions}`);
    return response({ serverNow: createdAt, campaign: adminCampaignView(campaign, [], env, epochMs) }, 201, cors);
  }
  if (url.pathname === "/admin/campaigns" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const [campaignRows, redemptionRows] = await Promise.all([
      env.DB.prepare(`SELECT * FROM offer_campaigns WHERE owner_member_id=? ORDER BY created_at DESC`).bind(member.id).all(),
      env.DB.prepare(`
        SELECT cr.*,c.title,c.reward_type,c.percent,c.max_redemptions,c.pack_count,c.expires_at,m.email,m.whatnot_username
        FROM campaign_redemptions cr
        JOIN offer_campaigns c ON c.id=cr.campaign_id
        JOIN members m ON m.id=cr.member_id
        WHERE c.owner_member_id=?
        ORDER BY c.created_at DESC,cr.claim_rank
      `).bind(member.id).all()
    ]);
    const byCampaign = new Map();
    for (const redemption of redemptionRows.results || []) {
      if (!byCampaign.has(redemption.campaign_id)) byCampaign.set(redemption.campaign_id, []);
      byCampaign.get(redemption.campaign_id).push(redemption);
    }
    const epochMs = Date.now();
    return response({ serverNow: new Date(epochMs).toISOString(), campaigns: (campaignRows.results || []).map(campaign => adminCampaignView(campaign, byCampaign.get(campaign.id) || [], env, epochMs)) }, 200, cors);
  }
  const adminCampaignQrMatch = url.pathname.match(/^\/admin\/campaigns\/([0-9a-f-]{36})\/qr$/i);
  if (adminCampaignQrMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE id=? AND owner_member_id=?`).bind(adminCampaignQrMatch[1], member.id).first();
    if (!campaign) return response({ error: "Campaign not found." }, 404, cors);
    await audit(env, request, "campaign_qr_generated", member.id, campaign.id);
    return svgResponse(await referralQrSvg(campaignUrl(campaign, env)), cors);
  }
  const adminCampaignRedeemMatch = url.pathname.match(/^\/admin\/campaign-redemptions\/([0-9a-f-]{36})\/redeem$/i);
  if (adminCampaignRedeemMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const redemption = await env.DB.prepare(`
      SELECT cr.*,c.title,c.reward_type,c.percent,c.max_redemptions,c.pack_count,c.expires_at,m.email,m.whatnot_username
      FROM campaign_redemptions cr
      JOIN offer_campaigns c ON c.id=cr.campaign_id
      JOIN members m ON m.id=cr.member_id
      WHERE cr.id=? AND c.owner_member_id=?
    `).bind(adminCampaignRedeemMatch[1], member.id).first();
    if (!redemption) return response({ error: "Campaign redemption not found." }, 404, cors);
    if (redemption.redeemed_at) return response({ error: "This campaign reward was already marked redeemed." }, 409, cors);
    if (redemption.expires_at <= now()) return response({ error: "This campaign reward has expired and cannot be redeemed." }, 410, cors);
    const redeemedAt = now();
    const updated = await env.DB.prepare(`UPDATE campaign_redemptions SET redeemed_at=?,redeemed_by_member_id=? WHERE id=? AND redeemed_at IS NULL`).bind(redeemedAt, member.id, redemption.id).run();
    if (Number(updated.meta?.changes || 0) !== 1) return response({ error: "This campaign reward was already marked redeemed." }, 409, cors);
    redemption.redeemed_at = redeemedAt;
    await audit(env, request, "campaign_redemption_redeemed", member.id, `${redemption.id}|member:${redemption.member_id}|code:${redemption.code}`);
    return response({ redemption: adminRedemptionView(redemption) }, 200, cors);
  }
  if (url.pathname === "/admin/summary" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const summary = await env.DB.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN redemption_requested_at IS NULL AND redeemed_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) issued,
        SUM(CASE WHEN redemption_requested_at IS NOT NULL AND redeemed_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) requested,
        SUM(CASE WHEN redeemed_at IS NOT NULL THEN 1 ELSE 0 END) redeemed,
        SUM(CASE WHEN redeemed_at IS NULL AND expires_at<=? THEN 1 ELSE 0 END) expired
      FROM discount_claims
    `).bind(now(), now(), now()).first();
    return response({ summary: { total: Number(summary?.total || 0), issued: Number(summary?.issued || 0), requested: Number(summary?.requested || 0), redeemed: Number(summary?.redeemed || 0), expired: Number(summary?.expired || 0) } }, 200, cors);
  }
  if (url.pathname === "/admin/discounts" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const query = clean(url.searchParams.get("q"), 80).toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9@._+ -]/g, "");
    const search = `%${query}%`;
    const status = ["all", "issued", "requested", "redeemed", "expired"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "all";
    const statusClause = {
      all: "1=1",
      issued: "dc.redemption_requested_at IS NULL AND dc.redeemed_at IS NULL AND dc.expires_at>?",
      requested: "dc.redemption_requested_at IS NOT NULL AND dc.redeemed_at IS NULL AND dc.expires_at>?",
      redeemed: "dc.redeemed_at IS NOT NULL",
      expired: "dc.redeemed_at IS NULL AND dc.expires_at<=?"
    }[status];
    const sql = `
      SELECT dc.id,dc.code,dc.percent,dc.expires_at,dc.redemption_requested_at,dc.redeemed_at,dc.created_at,
             m.id member_id,m.email,m.first_name,m.last_name,m.whatnot_username
      FROM discount_claims dc JOIN members m ON m.id=dc.member_id
      WHERE (?='' OR lower(dc.code) LIKE ? OR lower(m.email) LIKE ? OR lower(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')) LIKE ? OR lower(COALESCE(m.whatnot_username,'')) LIKE ?)
        AND ${statusClause}
      ORDER BY COALESCE(dc.redemption_requested_at,dc.created_at) DESC
      LIMIT 100
    `;
    const bindings = [query, search, search, search, search];
    if (status !== "all" && status !== "redeemed") bindings.push(now());
    const rows = await env.DB.prepare(sql).bind(...bindings).all();
    return response({ claims: rows.results || [] }, 200, cors);
  }
  const adminRedeemMatch = url.pathname.match(/^\/admin\/discounts\/([0-9a-f-]{36})\/redeem$/i);
  if (adminRedeemMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const claim = await env.DB.prepare(`SELECT dc.*,m.email FROM discount_claims dc JOIN members m ON m.id=dc.member_id WHERE dc.id=?`).bind(adminRedeemMatch[1]).first();
    if (!claim) return response({ error: "Discount claim not found." }, 404, cors);
    if (claim.redeemed_at) return response({ error: "This discount was already marked redeemed." }, 409, cors);
    if (claim.expires_at <= now()) return response({ error: "This discount code has expired and cannot be redeemed." }, 410, cors);
    const redeemedAt = now();
    const update = await env.DB.prepare(`UPDATE discount_claims SET redeemed_at=?,redeemed_by_member_id=? WHERE id=? AND redeemed_at IS NULL`).bind(redeemedAt, member.id, claim.id).run();
    if (Number(update.meta?.changes || 0) !== 1) return response({ error: "This discount was already marked redeemed." }, 409, cors);
    await audit(env, request, "admin_discount_redeemed", claim.member_id, `${claim.code}|admin:${member.id}`);
    return response({ id: claim.id, code: claim.code, memberEmail: claim.email, redeemedAt }, 200, cors);
  }
  if (url.pathname === "/invites" && request.method === "POST") {
    if (isOwnerEmail(member, env)) return response({ error: "Open the protected Owner Dashboard to copy the current owner referral link or QR." }, 403, cors);
    const data = await body(request); const invitee = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitee)) return response({ error: "Enter a valid friend email." }, 400, cors);
    if (invitee === member.email) return response({ error: "You cannot invite yourself." }, 400, cors);
    const existingMember = await env.DB.prepare(`SELECT id FROM members WHERE email=?`).bind(invitee).first();
    if (existingMember) return response({ error: "That email already belongs to a member." }, 409, cors);
    const recentInvites = await env.DB.prepare(`SELECT COUNT(*) count FROM invitations WHERE inviter_member_id=? AND created_at>?`).bind(member.id, new Date(Date.now() - 24 * 60 * 60e3).toISOString()).first();
    if (Number(recentInvites?.count || 0) >= 20) return response({ error: "Daily invitation limit reached. Try again tomorrow." }, 429, cors);
    const invitationId = id();
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO invitations(id,inviter_member_id,invitee_email,created_at) VALUES(?,?,?,?)`).bind(invitationId, member.id, invitee, now()).run();
    if (Number(inserted.meta?.changes || 0) !== 1) return response({ error: "That friend has already been invited from your account." }, 409, cors);
    const invite = await inviteDetailsFor(member, env); const link = invite.url;
    try {
      const expiration = invite.rotating ? `<p>This owner referral link is valid for the current ${escapeHtml(invite.windowLabel)} window and changes at ${escapeHtml(invite.nextBoundaryLabel)}.</p>` : "";
      await sendEmail(env, invitee, `${member.first_name} invited you to Crack Packs`, `<h1>Join Crack Packs Rewards</h1><p>${escapeHtml(member.first_name)} invited you to join the collector community.</p><p><a href="${escapeHtml(link)}">Verify your email and join</a></p>${expiration}`, invitationId);
    } catch (error) {
      await env.DB.prepare(`DELETE FROM invitations WHERE id=?`).bind(invitationId).run();
      throw error;
    }
    await audit(env, request, "invite_sent", member.id, invitee); return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/discount/claim" && request.method === "POST") {
    let claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
    if (!claim) {
      const epochMs = Date.now();
      const week = campaignWeekAt(epochMs);
      const campaignThisWeek = await env.DB.prepare(`SELECT id FROM campaign_redemptions WHERE member_id=? AND week_key=?`).bind(member.id, week.key).first();
      if (campaignThisWeek) return response({ error: "A campaign reward was already claimed during the current Thursday-to-Wednesday week." }, 409, cors);
      for (let attempt = 0; attempt < 5 && !claim; attempt += 1) {
        const claimId = id();
        const createdAt = new Date().toISOString();
        const code = `CP${randomString(10)}`;
        const expires = new Date(Date.parse(createdAt) + 30 * 86400e3).toISOString();
        const reservation = await weeklyReservation(env, member.id, week, "legacy_discount", claimId, createdAt);
        if (!reservation.reserved) {
          claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
          if (claim) break;
          return response({ error: "A reward code was already issued to this account during the current Thursday-to-Wednesday week." }, 409, cors);
        }
        const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO discount_claims(id,member_id,code,percent,expires_at,created_at) VALUES(?,?,?,?,?,?)`).bind(claimId, member.id, code, Number(env.DISCOUNT_PERCENT || 10), expires, createdAt).run();
        if (Number(inserted.meta?.changes || 0) === 1) {
          claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE id=?`).bind(claimId).first();
          await audit(env, request, "legacy_discount_claimed", member.id, `${claim.id}|week:${week.key}`);
          break;
        }
        await releaseWeeklyReservation(env, member.id, week.key, "legacy_discount", claimId);
        claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
      }
      if (!claim) return response({ error: "The discount code could not be issued. Try again." }, 409, cors);
    }
    return response({ code: claim.code, expiresAt: claim.expires_at, requestedAt: claim.redemption_requested_at || null, redeemedAt: claim.redeemed_at || null, description: `${claim.percent}% off one eligible order.` }, 200, cors);
  }
  if (url.pathname === "/discount/redeem" && request.method === "POST") {
    const claim = await env.DB.prepare(`SELECT * FROM discount_claims WHERE member_id=?`).bind(member.id).first();
    if (!claim) return response({ error: "Claim your discount code before requesting redemption." }, 400, cors);
    if (claim.redeemed_at) return response({ error: "This discount code has already been redeemed." }, 409, cors);
    if (claim.expires_at <= now()) return response({ error: "This discount code has expired." }, 410, cors);
    if (claim.redemption_requested_at) return response({ code: claim.code, requestedAt: claim.redemption_requested_at, alreadyRequested: true }, 200, cors);
    const requestedAt = now();
    const update = await env.DB.prepare(`UPDATE discount_claims SET redemption_requested_at=? WHERE id=? AND redemption_requested_at IS NULL AND redeemed_at IS NULL`).bind(requestedAt, claim.id).run();
    if (Number(update.meta?.changes || 0) !== 1) return response({ error: "This redemption was already requested." }, 409, cors);
    const notifyEmail = normalizeEmail(env.DISCOUNT_NOTIFY_EMAIL || "hello@crackpacks.com");
    try {
      await sendEmail(
        env,
        notifyEmail,
        `Whatnot discount requested: ${claim.code}`,
        `<h1>Whatnot discount requested</h1><p><strong>Code:</strong> ${escapeHtml(claim.code)}</p><p><strong>Discount:</strong> ${Number(claim.percent)}%</p><p><strong>Member:</strong> ${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</p><p><strong>Member email:</strong> ${escapeHtml(member.email)}</p><p><strong>Collector username:</strong> ${escapeHtml(member.whatnot_username || "Not provided")}</p><p><strong>Requested:</strong> ${escapeHtml(requestedAt)}</p><p>After the buyer actually uses this code during a Whatnot show, open the owner dashboard and mark it Redeemed.</p>`,
        `discount-request-${claim.id}`
      );
      await audit(env, request, "discount_redemption_requested", member.id, claim.code);
    } catch (error) {
      console.error("Discount notification failed", error);
      await audit(env, request, "discount_request_notification_failed", member.id, claim.code);
    }
    return response({ code: claim.code, requestedAt }, 200, cors);
  }
  return response({ error: "Not found." }, 404, cors);
}
export default { async fetch(request, env, ctx) {
  const cors = corsFor(request, env); if (!cors) return response({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try { return await route(request, env, cors, ctx); } catch (error) { console.error(error); return response({ error: error.message === "INVALID_JSON" ? "Invalid request body." : "The rewards service encountered an error." }, 500, cors); }
}};
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { EmailMessage } from "cloudflare:email";
