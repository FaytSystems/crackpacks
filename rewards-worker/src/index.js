import QRCode from "qrcode";
import { issueOwnerReferral, ownerReferralSlotAt, verifyOwnerReferral } from "./referral-rotation.js";
import { campaignWeekAt, parseCampaignExpiryHours } from "./campaign-time.js";
import { calculateChannelPricing, channelPricingErrors } from "./channel-pricing.js";
import { sanitizeEasyPostTracker, verifyEasyPostWebhook } from "./easypost-tracking.js";
import { handlePlatformRoute, runStreamCreditCycle, usernameKey } from "./platform-routes.js";

const VERSION = "5.0.0";
const CAMPAIGN_REWARD_TYPES = new Set(["percent", "free_shipping", "pick_a_pack", "pack_draft", "free_single", "product"]);
const MAX_CAMPAIGN_REDEMPTIONS = 500;
const STORE_CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "JPY", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON"]);
const STORE_QUOTE_TTL_MS = 10 * 60e3;
const STARTER_INVENTORY = [
  { publicSlug: "pitch-black-booster-box-36", name: "Mega Evolution—Pitch Black Booster Box (36 Packs)", upc: "196214157514", category: "Booster Box", averageMsrpCents: 16099, imageUrl: "assets/images/release-pitch-black-box.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-pitch-black-booster-box-36-packs/JJG2TL8C7R/sku/6678362" },
  { publicSlug: "pitch-black-elite-trainer-box", name: "Mega Evolution—Pitch Black Elite Trainer Box", upc: "196214157422", category: "Elite Trainer Box", averageMsrpCents: 4999, imageUrl: "assets/images/release-pitch-black-etb.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-pitch-black-elite-trainer-box/JJG2TL8J45/sku/6678361" },
  { publicSlug: "pitch-black-booster-bundle-6", name: "Mega Evolution—Pitch Black Booster Bundle (6 Packs)", upc: "196214157484", category: "Booster Bundle", averageMsrpCents: 2694, imageUrl: "assets/images/release-pitch-black-bundle.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-pitch-black-booster-bundle/JJG2TL8JVY/sku/6678359" },
  { publicSlug: "pitch-black-three-pack-booster", name: "Mega Evolution—Pitch Black 3-Pack Booster", upc: "196214157477", category: "Blister", averageMsrpCents: 1399, imageUrl: "assets/images/release-pitch-black-three.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-pitch-black-3pk-booster/JJG2TL8JVC/sku/6678388" },
  { publicSlug: "pitch-black-sleeved-booster", name: "Mega Evolution—Pitch Black Sleeved Booster", upc: null, category: "Booster Pack", averageMsrpCents: 449, imageUrl: "assets/images/product-cosmic.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-mega-evolution-pitch-black-sleeved-booster-styles-may-vary/JJG2TL32P8/sku/6678360" },
  { publicSlug: "mega-greninja-ex-premium-collection", name: "Mega Greninja ex Premium Collection", upc: "196214155923", category: "Premium Collection", averageMsrpCents: 4499, imageUrl: "assets/images/product-aurora.svg", sourceUrl: "https://www.target.com/p/-/A-1011209273" },
  { publicSlug: "pitch-black-build-and-battle", name: "Mega Evolution—Pitch Black Build & Battle Box", upc: null, category: "Build & Battle", averageMsrpCents: null, imageUrl: "assets/images/product-electric.svg", sourceUrl: "https://www.pokemon.com/us/news/check-out-every-pokemon-tcg-product-release-in-july-2026" },
  { publicSlug: "chaos-rising-booster-box-36", name: "Mega Evolution—Chaos Rising Booster Box (36 Packs)", upc: null, category: "Booster Box", averageMsrpCents: 16099, imageUrl: "assets/images/product-flame.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-chaos-rising-booster-box-36-packs/JJG2TL34TS" },
  { publicSlug: "chaos-rising-elite-trainer-box", name: "Mega Evolution—Chaos Rising Elite Trainer Box", upc: null, category: "Elite Trainer Box", averageMsrpCents: 4999, imageUrl: "assets/images/product-flame.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-chaos-rising-elite-trainer-box/JJG2TL34RT/sku/6673725" },
  { publicSlug: "chaos-rising-booster-bundle-6", name: "Mega Evolution—Chaos Rising Booster Bundle (6 Packs)", upc: null, category: "Booster Bundle", averageMsrpCents: 2694, imageUrl: "assets/images/product-flame.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle/JJG2TL34H9/sku/6673721" },
  { publicSlug: "perfect-order-booster-box-36", name: "Mega Evolution—Perfect Order Booster Box (36 Packs)", upc: "196214150461", category: "Booster Box", averageMsrpCents: 16099, imageUrl: "assets/images/product-electric.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-perfect-order-booster-box-36-packs/JJG2TL3QWX/sku/6668619" },
  { publicSlug: "perfect-order-elite-trainer-box", name: "Mega Evolution—Perfect Order Elite Trainer Box", upc: null, category: "Elite Trainer Box", averageMsrpCents: 4999, imageUrl: "assets/images/product-electric.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-perfect-order-elite-trainer-box/JJG2TL3W86/sku/6668618" },
  { publicSlug: "perfect-order-booster-bundle-6", name: "Mega Evolution—Perfect Order Booster Bundle (6 Packs)", upc: "196214150478", category: "Booster Bundle", averageMsrpCents: 2694, imageUrl: "assets/images/product-electric.svg", sourceUrl: "https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-perfect-order-booster-bundle/JJG2TL3QK2/sku/6668627" }
];
const TIERS = [
  { threshold: 0, name: "Starter", reward: "Member access" },
  { threshold: 3, name: "Crew", reward: "Bonus discount" },
  { threshold: 10, name: "Breaker", reward: "Free shipping reward" },
  { threshold: 25, name: "Headliner", reward: "Crack Packs prize pack" },
  { threshold: 50, name: "Legend", reward: "VIP campaign grand prize entry" }
];
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalizeEmail = value => String(value || "").trim().toLowerCase().slice(0, 254);
const clean = (value, max = 64) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const optionalInteger = (value, min, max) => value === "" || value === null || value === undefined ? null : Number.isInteger(value) && value >= min && value <= max ? value : NaN;
const optionalNumber = (value, min, max) => value === "" || value === null || value === undefined ? null : Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : NaN;
function parseInventoryItemInput(data) {
  const rawName = boundedString(data?.name, 120);
  const rawUpc = boundedString(data?.upc, 32);
  const rawCategory = boundedString(data?.category, 64);
  const rawDescription = boundedString(data?.description, 1000);
  const rawImageUrl = boundedString(data?.imageUrl, 500);
  const rawSourceUrl = boundedString(data?.sourceUrl, 500);
  const rawPackingNotes = boundedString(data?.packingNotes, 500);
  const rawOriginCountry = boundedString(data?.originCountry, 2);
  const rawHsCode = boundedString(data?.hsCode, 12);
  const rawReferenceLabel = boundedString(data?.referencePriceLabel, 80);
  const rawSeries = boundedString(data?.series, 16);
  if ([rawName, rawUpc, rawCategory, rawDescription, rawImageUrl, rawSourceUrl, rawPackingNotes, rawOriginCountry, rawHsCode, rawReferenceLabel].includes(null)) return { error: "Inventory text is too long." };
  const name = clean(rawName, 120);
  const upcInput = String(rawUpc || "").trim();
  if (upcInput && !/^[0-9\s-]+$/.test(upcInput)) return { error: "UPC must contain digits only." };
  const upc = upcInput.replace(/[\s-]/g, "");
  if (!name || name.length < 2) return { error: "Enter an inventory product name from 2 to 120 characters." };
  if (upc && !/^\d{6,18}$/.test(upc)) return { error: "UPC must contain 6 to 18 digits." };
  const imageUrl = String(rawImageUrl || "").trim();
  const sourceUrl = String(rawSourceUrl || "").trim();
  for (const [label, value] of [["Image URL", imageUrl], ["Source URL", sourceUrl]]) {
    if (value && !/^https:\/\//i.test(value) && !/^assets\/images\/[a-z0-9._/-]+$/i.test(value)) return { error: `${label} must use HTTPS or a local assets/images path.` };
  }
  const quantity = optionalInteger(data?.quantity ?? 0, 0, 100000);
  const averageMsrpCents = optionalInteger(data?.averageMsrpCents, 0, 100000000);
  const cogsCents = optionalInteger(data?.cogsCents, 0, 100000000);
  const usShippingCents = optionalInteger(data?.usShippingCents, 0, 10000000);
  const profitCents = optionalInteger(data?.profitCents ?? 1000, 0, 10000000);
  const packagingCents = optionalInteger(data?.packagingCents, 0, 10000000);
  const overheadCents = optionalInteger(data?.overheadCents, 0, 10000000);
  const retailFixedFeeCents = optionalInteger(data?.retailFixedFeeCents, 0, 10000000);
  const wholesaleHandlingCents = optionalInteger(data?.wholesaleHandlingCents, 0, 10000000);
  const retailListPriceCents = optionalInteger(data?.retailListPriceCents, 0, 100000000);
  const websiteListPriceCents = optionalInteger(data?.websiteListPriceCents, 0, 100000000);
  const internationalListPriceCents = optionalInteger(data?.internationalListPriceCents, 0, 100000000);
  const liveListPriceCents = optionalInteger(data?.liveListPriceCents, 0, 100000000);
  const wholesaleSmallListPriceCents = optionalInteger(data?.wholesaleSmallListPriceCents, 0, 100000000);
  const wholesaleCaseListPriceCents = optionalInteger(data?.wholesaleCaseListPriceCents, 0, 100000000);
  const wholesalePalletListPriceCents = optionalInteger(data?.wholesalePalletListPriceCents, 0, 100000000);
  const weightOz = optionalNumber(data?.weightOz, 0.01, 2400);
  const lengthIn = optionalNumber(data?.lengthIn, 0.01, 120);
  const widthIn = optionalNumber(data?.widthIn, 0.01, 120);
  const heightIn = optionalNumber(data?.heightIn, 0.01, 120);
  if ([quantity, averageMsrpCents, cogsCents, usShippingCents, profitCents, packagingCents, overheadCents, retailFixedFeeCents, wholesaleHandlingCents,
    retailListPriceCents, websiteListPriceCents, internationalListPriceCents, liveListPriceCents, wholesaleSmallListPriceCents,
    wholesaleCaseListPriceCents, wholesalePalletListPriceCents, weightOz, lengthIn, widthIn, heightIn].some(Number.isNaN)) return { error: "Check the inventory quantity, pricing, weight, and package dimensions." };
  const originCountry = String(rawOriginCountry || "").trim().toUpperCase();
  if (originCountry && !/^[A-Z]{2}$/.test(originCountry)) return { error: "Country of origin must be a two-letter code." };
  const hsCode = String(rawHsCode || "").trim();
  if (hsCode && !/^[0-9.]{4,12}$/.test(hsCode)) return { error: "HS code must contain 4 to 12 digits or periods." };
  const series = String(rawSeries || "pokemon").trim().toLowerCase();
  if (!["pokemon", "magic"].includes(series)) return { error: "Choose Pokémon or Magic for the product series." };
  const referencePriceObservedAt = String(data?.referencePriceObservedAt || "").trim();
  if (referencePriceObservedAt && !/^\d{4}-\d{2}-\d{2}$/.test(referencePriceObservedAt)) return { error: "Reference-price date must use YYYY-MM-DD." };
  const item = {
      name, upc: upc || null, category: clean(rawCategory, 64), series, description: String(rawDescription || "").trim(), imageUrl, sourceUrl,
      quantity, averageMsrpCents, referencePriceLabel: clean(rawReferenceLabel || "Retail reference price", 80), referencePriceObservedAt: referencePriceObservedAt || null,
      cogsCents, usShippingCents, profitCents, packagingCents, overheadCents, retailFixedFeeCents, wholesaleHandlingCents,
      retailListPriceCents, websiteListPriceCents, internationalListPriceCents, liveListPriceCents,
      wholesaleSmallListPriceCents, wholesaleCaseListPriceCents, wholesalePalletListPriceCents,
      weightOz, lengthIn, widthIn, heightIn,
      originCountry, hsCode, packingNotes: String(rawPackingNotes || "").trim(),
      isStoreVisible: data?.isStoreVisible !== false, isActive: data?.isActive !== false
  };
  const pricingErrors = channelPricingErrors(item);
  return pricingErrors.length ? { error: pricingErrors[0] } : { item };
}
const boundedString = (value, max) => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" && value.length <= max ? value : null;
};
const slugify = value => clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "product";
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const randomString = (length, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join("");
async function hash(value, secret = "") {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${value}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const bytesToBase64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const base64urlToBytes = value => Uint8Array.from(atob(String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=")), char => char.charCodeAt(0));
function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 10 || password.length > 128) return "Password must be 10 to 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must include at least one letter and one number.";
  return "";
}
async function passwordDigest(password, saltBase64url, pepper) {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(`${pepper || ""}:${password}`), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64urlToBytes(saltBase64url), iterations: PASSWORD_ITERATIONS }, keyMaterial, 256);
  return bytesToBase64url(new Uint8Array(bits));
}
async function newPasswordRecord(password, pepper) {
  const salt = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
  return { salt, digest: await passwordDigest(password, salt, pepper) };
}
async function issueMemberSession(env, memberId) {
  const token = randomString(48);
  await env.DB.prepare(`INSERT INTO sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)`).bind(await hash(token, env.AUTH_SECRET), memberId, new Date(Date.now() + 30 * 86400e3).toISOString(), now()).run();
  return token;
}
function response(body, status = 200, cors = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } }); }
function svgResponse(svg, cors = {}) { return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": "inline; filename=crack-packs-referral-qr.svg", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", ...cors } }); }
function corsFor(request, env) {
  const origin = request.headers.get("Origin"); const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim());
  if (!origin) return { "Access-Control-Allow-Origin": "*" };
  return allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : null;
}
async function body(request) { try { return await request.json(); } catch { throw new Error("INVALID_JSON"); } }
async function sendEmail(env, to, subject, html, idempotencyKey = id(), fromAddress = "rewards@crackpacks.com") {
  const text = String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  if (env.RESEND_API_KEY) {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        from: `${fromAddress === "orders@crackpacks.com" ? "Crack Packs Orders" : "Crack Packs Rewards"} <${fromAddress}>`,
        to: [to],
        subject,
        html,
        text
      })
    });
    if (result.ok) return;
    {
      const payload = await result.json().catch(() => ({}));
      console.error("Resend delivery failed", { status: result.status, name: payload.name || "", message: payload.message || "" });
    }
  }
  if (!env.REWARDS_EMAIL) {
    if (env.ENVIRONMENT === "development") return;
    throw new Error(env.RESEND_API_KEY ? "EMAIL_DELIVERY_FAILED" : "EMAIL_NOT_CONFIGURED");
  }
  if (fromAddress !== "rewards@crackpacks.com") throw new Error("EMAIL_NOT_CONFIGURED");
  try {
    await env.REWARDS_EMAIL.send({
      to,
      from: { email: "rewards@crackpacks.com", name: "Crack Packs Rewards" },
      replyTo: "support@crackpacks.com",
      subject,
      html,
      text,
      headers: { "X-Message-ID": idempotencyKey }
    });
  } catch (error) {
    console.error("Cloudflare email delivery failed", { code: error?.code || "", message: error?.message || "" });
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}
async function sendMemberEmailBatch(env, recipients, subject, message, idempotencyKey, senderAddress = "rewards@crackpacks.com") {
  if (!env.RESEND_API_KEY) throw new Error("MEMBER_EMAIL_NOT_CONFIGURED");
  const messageHtml = escapeHtml(message).replace(/\r?\n/g, "<br>");
  const payload = recipients.map(recipient => ({
    from: `Crack Packs <${senderAddress}>`,
    to: [recipient.email],
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#111827"><h1 style="color:#151936">Crack Packs</h1><p>Hi ${escapeHtml(recipient.first_name || recipient.live_username || "collector")},</p><p>${messageHtml}</p><p style="margin-top:28px;color:#5d6475;font-size:12px">This member-account message was sent by Crack Packs. Reply to this email if you no longer want member announcements.</p></div>`,
    headers: { "List-Unsubscribe": `<mailto:${senderAddress}?subject=Unsubscribe>` }
  }));
  const result = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload)
  });
  if (!result.ok) {
    const details = await result.json().catch(() => ({}));
    console.error("Member email batch failed", { status: result.status, name: details.name || "", message: details.message || "" });
    throw new Error("MEMBER_EMAIL_DELIVERY_FAILED");
  }
  return result.json().catch(() => ({}));
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
    const isActive = await ownerReferralIsActive(env, member.id, current.id);
    return {
      url: current.url,
      displayCode: "LIVE 12H",
      rotating: true,
      ownerDashboardOnly: false,
      startsAt: current.startsAt,
      expiresAt: current.expiresAt,
      windowLabel: current.label,
      nextBoundaryLabel: current.nextBoundaryLabel,
      serverNow: new Date(epochMs).toISOString(),
      isActive
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
const campaignRewardType = campaign => campaign.inventory_item_id ? "product" : campaign.reward_variant || campaign.reward_type;
const campaignProduct = (campaign, ownerView = false) => campaign.inventory_item_id ? {
  name: campaign.product_name_snapshot || "Inventory product",
  ...(ownerView ? { inventoryItemId: campaign.inventory_item_id, upc: campaign.product_upc_snapshot || "" } : {})
} : null;
const cents = value => value === null || value === undefined ? null : Number(value);
const channelPricingInput = row => ({
  cogsCents: cents(row.cogs_cents),
  usShippingCents: cents(row.us_shipping_cents),
  packagingCents: cents(row.packaging_cents),
  overheadCents: cents(row.overhead_cents),
  retailFixedFeeCents: cents(row.retail_fixed_fee_cents),
  wholesaleHandlingCents: cents(row.wholesale_handling_cents),
  retailListPriceCents: cents(row.retail_list_price_cents),
  websiteListPriceCents: cents(row.website_list_price_cents),
  internationalListPriceCents: cents(row.international_list_price_cents),
  liveListPriceCents: cents(row.live_list_price_cents),
  wholesaleSmallListPriceCents: cents(row.wholesale_small_list_price_cents),
  wholesaleCaseListPriceCents: cents(row.wholesale_case_list_price_cents),
  wholesalePalletListPriceCents: cents(row.wholesale_pallet_list_price_cents)
});
const storePriceCents = (row, market) => {
  const pricing = calculateChannelPricing(channelPricingInput(row));
  return market === "us" ? pricing.prices.websiteUs : pricing.prices.websiteInternational;
};
const inventoryItemView = row => {
  const committedUnits = Math.max(0, Number(row.committed_units || 0));
  const quantity = Number(row.quantity || 0);
  const availableQuantity = Math.max(0, quantity - committedUnits);
  const channelPricing = calculateChannelPricing(channelPricingInput(row));
  return ({
  id: row.id,
  publicSlug: row.public_slug,
  name: row.name,
  upc: row.upc || "",
  category: row.category || "",
  series: row.series || "pokemon",
  description: row.description || "",
  imageUrl: row.image_url || "",
  sourceUrl: row.source_url || "",
  quantity,
  committedUnits,
  availableQuantity,
  averageMsrpCents: cents(row.average_msrp_cents),
  referencePriceLabel: row.reference_price_label || "Retail reference price",
  referencePriceObservedAt: row.reference_price_observed_at || null,
  cogsCents: cents(row.cogs_cents),
  usShippingCents: cents(row.us_shipping_cents),
  profitCents: cents(row.profit_cents),
  packagingCents: cents(row.packaging_cents),
  overheadCents: cents(row.overhead_cents),
  retailFixedFeeCents: cents(row.retail_fixed_fee_cents),
  wholesaleHandlingCents: cents(row.wholesale_handling_cents),
  retailListPriceCents: cents(row.retail_list_price_cents),
  websiteListPriceCents: cents(row.website_list_price_cents),
  internationalListPriceCents: cents(row.international_list_price_cents),
  liveListPriceCents: cents(row.live_list_price_cents),
  wholesaleSmallListPriceCents: cents(row.wholesale_small_list_price_cents),
  wholesaleCaseListPriceCents: cents(row.wholesale_case_list_price_cents),
  wholesalePalletListPriceCents: cents(row.wholesale_pallet_list_price_cents),
  channelPricing,
  usStorePriceCents: channelPricing.prices.websiteUs,
  internationalStorePriceCents: channelPricing.prices.websiteInternational,
  weightOz: row.weight_oz === null || row.weight_oz === undefined ? null : Number(row.weight_oz),
  lengthIn: row.length_in === null || row.length_in === undefined ? null : Number(row.length_in),
  widthIn: row.width_in === null || row.width_in === undefined ? null : Number(row.width_in),
  heightIn: row.height_in === null || row.height_in === undefined ? null : Number(row.height_in),
  originCountry: row.origin_country || "",
  hsCode: row.hs_code || "",
  packingNotes: row.packing_notes || "",
  isStoreVisible: Number(row.is_store_visible) === 1,
  isActive: Number(row.is_active) === 1,
  campaignReady: Number(row.is_active) === 1 && availableQuantity > 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at
  });
};
async function inventoryCommittedUnits(env, inventoryItemId, ownerMemberId, epochIso = now(), excludedCampaignId = "") {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN campaign.is_active=1 AND campaign.expires_at>? THEN
          MAX(campaign.max_redemptions - (
            SELECT COUNT(*) FROM campaign_redemptions fulfilled
            WHERE fulfilled.campaign_id=campaign.id AND fulfilled.redeemed_at IS NOT NULL
          ),0)
        ELSE (
          SELECT COUNT(*) FROM campaign_redemptions promised
          WHERE promised.campaign_id=campaign.id AND promised.redeemed_at IS NULL
        )
      END
    ),0) total
    FROM offer_campaigns campaign
    WHERE campaign.inventory_item_id=? AND campaign.owner_member_id=?
      AND (?='' OR campaign.id<>?)
  `).bind(epochIso, inventoryItemId, ownerMemberId, excludedCampaignId, excludedCampaignId).first();
  return Math.max(0, Number(row?.total || 0));
}
const convertCents = (usdCents, rate) => usdCents === null || rate === null ? null : Math.round(usdCents * rate);
async function ecbFxQuote(currency) {
  if (currency === "USD") return { value: 1, source: "USD", asOf: new Date().toISOString().slice(0, 10) };
  const cache = globalThis.caches?.default;
  const cacheKey = new Request("https://rewards-api.crackpacks.com/.well-known/ecb-daily-rates-v1");
  let xml = "";
  let asOf = "";
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const payload = await cached.json().catch(() => null);
      if (payload?.xml) { xml = payload.xml; asOf = payload.asOf || ""; }
    }
  }
  if (!xml) {
    const result = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { headers: { Accept: "application/xml,text/xml" } });
    if (!result.ok) throw new Error("FX_UNAVAILABLE");
    xml = await result.text();
    asOf = xml.match(/time=['\"](\d{4}-\d{2}-\d{2})['\"]/)?.[1] || new Date().toISOString().slice(0, 10);
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify({ xml, asOf }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" } }));
  }
  const perEuro = { EUR: 1 };
  for (const match of xml.matchAll(/currency=['\"]([A-Z]{3})['\"]\s+rate=['\"]([0-9.]+)['\"]/g)) perEuro[match[1]] = Number(match[2]);
  if (!Number.isFinite(perEuro.USD) || !Number.isFinite(perEuro[currency])) throw new Error("FX_UNAVAILABLE");
  return { value: perEuro[currency] / perEuro.USD, source: "European Central Bank reference rate", asOf };
}
function publicStoreItem(row, market, currency, fx) {
  const usdPrice = storePriceCents(row, market);
  const msrpUsd = cents(row.average_msrp_cents);
  const availableQuantity = Math.max(0, Number(row.quantity || 0) - Number(row.committed_units || 0));
  const dimensionsReady = [row.weight_oz, row.length_in, row.width_in, row.height_in].every(value => Number(value) > 0);
  const customsReady = market === "us" || (String(row.origin_country || "").length === 2 && String(row.hs_code || "").length >= 4);
  return {
    slug: row.public_slug,
    name: row.name,
    category: row.category || "Trading Card Product",
    series: row.series || "pokemon",
    description: row.description || "",
    imageUrl: row.image_url || "assets/images/product-cosmic.svg",
    sourceUrl: row.source_url || "",
    available: availableQuantity > 0,
    quantityLabel: availableQuantity > 0 ? "Available" : "Coming Soon",
    msrp: msrpUsd === null ? null : {
      usdCents: msrpUsd,
      displayCents: convertCents(msrpUsd, fx?.value ?? null),
      currency,
      label: row.reference_price_label || "Retail reference price",
      observedAt: row.reference_price_observed_at || null
    },
    price: usdPrice === null ? null : {
      usdCents: usdPrice,
      displayCents: convertCents(usdPrice, fx?.value ?? null),
      currency,
      includesUsShipping: market === "us"
    },
    shippingReady: dimensionsReady && customsReady
  };
}
function parseShippingAddress(input) {
  const fields = {
    name: boundedString(input?.name, 100), street1: boundedString(input?.street1, 120), street2: boundedString(input?.street2, 120),
    city: boundedString(input?.city, 80), state: boundedString(input?.state, 80), postalCode: boundedString(input?.postalCode, 24),
    country: boundedString(input?.country, 2), phone: boundedString(input?.phone, 32), email: boundedString(input?.email, 254)
  };
  if (Object.values(fields).includes(null)) return { error: "Shipping address fields are too long." };
  const address = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value || "").trim()]));
  address.country = address.country.toUpperCase();
  if (!address.name || !address.street1 || !address.city || !address.postalCode || !/^[A-Z]{2}$/.test(address.country)) return { error: "Enter a complete shipping name, street, city, postal code, and two-letter country." };
  if (address.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) return { error: "Enter a valid shipping email address." };
  return { address };
}
const easyPostAddress = address => ({
  name: address.name, street1: address.street1, street2: address.street2 || undefined, city: address.city,
  state: address.state || undefined, zip: address.postalCode, country: address.country,
  phone: address.phone || undefined, email: address.email || undefined
});
async function easyPostShipmentQuote(env, item, quantity, address, apiKeyOverride = "") {
  if (quantity !== 1) throw new Error("MULTI_ITEM_PACKING_NOT_READY");
  const apiKey = apiKeyOverride || env.EASYPOST_API_KEY || env.EASYPOST_TEST_API_KEY || "";
  if (!apiKey) throw new Error("SHIPPING_NOT_CONFIGURED");
  let from;
  try { from = JSON.parse(env.SHIP_FROM_ADDRESS_JSON || ""); } catch { throw new Error("SHIP_FROM_NOT_CONFIGURED"); }
  const parsedFrom = parseShippingAddress({
    name: from.name, street1: from.street1, street2: from.street2, city: from.city, state: from.state,
    postalCode: from.postalCode || from.zip, country: from.country || "US", phone: from.phone, email: from.email
  });
  if (parsedFrom.error) throw new Error("SHIP_FROM_NOT_CONFIGURED");
  if (![item.weight_oz, item.length_in, item.width_in, item.height_in].every(value => Number(value) > 0)) throw new Error("PACKAGE_NOT_CONFIGURED");
  const shipment = {
    to_address: easyPostAddress(address),
    from_address: easyPostAddress(parsedFrom.address),
    parcel: { weight: Number(item.weight_oz), length: Number(item.length_in), width: Number(item.width_in), height: Number(item.height_in) }
  };
  if (address.country !== "US") {
    const declaredValue = storePriceCents(item, "international");
    if (!item.origin_country || !item.hs_code || declaredValue === null || declaredValue < 1) throw new Error("CUSTOMS_NOT_CONFIGURED");
    const configuredIncoterm = clean(env.INTERNATIONAL_INCOTERM || "DAP", 8).toUpperCase();
    if (configuredIncoterm !== "DAP") throw new Error("CUSTOMS_NOT_CONFIGURED");
    const eelPfc = clean(env.EASYPOST_EEL_PFC || "NOEEI 30.37(a)", 64);
    if (declaredValue >= 250000 && !env.EASYPOST_EEL_PFC) throw new Error("CUSTOMS_NOT_CONFIGURED");
    shipment.customs_info = {
      customs_certify: true,
      customs_signer: parsedFrom.address.name,
      contents_type: "merchandise",
      eel_pfc: eelPfc,
      incoterm: "DAP",
      non_delivery_option: "return",
      restriction_type: "none",
      customs_items: [{
        description: clean(item.description || item.name, 255), quantity: 1, weight: Number(item.weight_oz),
        value: (declaredValue / 100).toFixed(2), hs_tariff_number: item.hs_code, origin_country: item.origin_country
      }]
    };
  }
  const result = await fetch("https://api.easypost.com/v2/shipments", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ shipment })
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    console.error("EasyPost rating failed", { status: result.status, code: payload?.error?.code || "" });
    throw new Error("SHIPPING_PROVIDER_ERROR");
  }
  const rates = (Array.isArray(payload.rates) ? payload.rates : []).map(rate => ({
    id: String(rate.id || ""), carrier: clean(rate.carrier, 60), service: clean(rate.service, 80),
    amountCents: Math.round(Number(rate.rate) * 100), deliveryDays: Number.isInteger(rate.delivery_days) ? rate.delivery_days : null
  })).filter(rate => rate.id && Number.isInteger(rate.amountCents) && rate.amountCents >= 0).sort((left, right) => left.amountCents - right.amountCents).slice(0, 12);
  if (!rates.length || !payload.id) throw new Error("NO_SHIPPING_RATES");
  return { shipmentId: String(payload.id), mode: String(payload.mode || ""), rates };
}
async function easyPostCreateTracker(env, trackingCode, carrier = "") {
  const apiKey = env.EASYPOST_API_KEY || env.EASYPOST_TEST_API_KEY || "";
  if (!apiKey) throw new Error("TRACKING_NOT_CONFIGURED");
  const tracker = { tracking_code: trackingCode };
  if (carrier) tracker.carrier = carrier;
  const result = await fetch("https://api.easypost.com/v2/trackers", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ tracker })
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    console.error("EasyPost tracker creation failed", { status: result.status, code: payload?.error?.code || "" });
    throw new Error("TRACKING_PROVIDER_ERROR");
  }
  const sanitized = sanitizeEasyPostTracker(payload);
  if (!sanitized?.trackingCode || !sanitized.carrier) throw new Error("TRACKING_PROVIDER_ERROR");
  return sanitized;
}
function parseOrderItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const items = value.map(item => {
    const name = clean(item?.name, 160);
    const quantity = Number(item?.quantity ?? 1);
    return name && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100 ? { name, quantity } : null;
  });
  return items.includes(null) ? null : items;
}
function orderView(row, env) {
  let items = [];
  let details = [];
  try { items = JSON.parse(row.items_json || "[]"); } catch {}
  try { details = JSON.parse(row.tracking_details_json || "[]"); } catch {}
  const hasTracking = Boolean(row.easypost_tracker_id);
  return {
    id: row.id,
    orderNumber: row.order_number,
    channel: row.channel,
    items: Array.isArray(items) ? items : [],
    status: row.status,
    paymentStatus: row.payment_status || "not_applicable",
    totalCents: Number(row.total_cents || 0),
    currency: row.currency || "USD",
    placedAt: row.placed_at,
    updatedAt: row.updated_at,
    label: row.label_purchased_at ? { ordered: true, purchasedAt: row.label_purchased_at, url: row.postage_label_pdf_url || row.postage_label_url || "" } : { ordered: false },
    tracking: hasTracking ? {
      carrier: row.carrier,
      trackingCode: row.tracking_code,
      status: row.tracking_status || "unknown",
      statusDetail: row.status_detail || "",
      estimatedDeliveryDate: row.estimated_delivery_date || null,
      carrierPublicUrl: row.carrier_public_url || "",
      mode: row.tracking_mode || "test",
      details: Array.isArray(details) ? details : [],
      url: `${env.SITE_URL}/tracking.html?order=${encodeURIComponent(row.id)}`
    } : null
  };
}
const orderSelectSql = `
  SELECT orders.*,shipments.easypost_tracker_id,shipments.mode tracking_mode,shipments.carrier,shipments.tracking_code,
         shipments.status tracking_status,shipments.status_detail,shipments.estimated_delivery_date,
         shipments.carrier_public_url,shipments.tracking_details_json,shipments.label_purchased_at,
         shipments.postage_label_url,shipments.postage_label_pdf_url
  FROM member_orders orders LEFT JOIN order_shipments shipments ON shipments.order_id=orders.id
`;
const campaignNeverExpires = campaign => Number(campaign.never_expires || 0) === 1;
const campaignIsActive = campaign => Number(campaign.is_active ?? 1) === 1;
async function ownerReferralIsActive(env, ownerMemberId, slotId) {
  const control = await env.DB.prepare(`SELECT is_active FROM owner_referral_controls WHERE owner_member_id=? AND slot_id=?`).bind(ownerMemberId, slotId).first();
  return control ? Number(control.is_active) === 1 : true;
}
const campaignState = (campaign, redemptionCount, epochMs = Date.now()) => {
  if (!campaignIsActive(campaign)) return "disabled";
  if (!campaignNeverExpires(campaign) && Date.parse(campaign.expires_at) <= epochMs) return "expired";
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
    rewardType: campaignRewardType(row),
    percent: row.percent === null || row.percent === undefined ? null : Number(row.percent),
    maxRedemptions: Number(row.max_redemptions),
    packCount: row.pack_count === null || row.pack_count === undefined ? null : Number(row.pack_count),
    campaignExpiresAt: campaignNeverExpires(row) ? null : row.expires_at,
    expiresAt: campaignNeverExpires(row) ? null : row.expires_at,
    neverExpires: campaignNeverExpires(row),
    product: campaignProduct(row),
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
    product: campaignProduct(row, true),
    memberId: row.member_id,
    email: row.email,
    liveUsername: row.live_username || ""
  };
}
function adminCampaignView(campaign, redemptions, env, epochMs = Date.now()) {
  const redemptionCount = redemptions.length;
  return {
    id: campaign.id,
    title: campaign.title,
    rewardType: campaignRewardType(campaign),
    percent: campaign.percent === null || campaign.percent === undefined ? null : Number(campaign.percent),
    maxRedemptions: Number(campaign.max_redemptions),
    packCount: campaign.pack_count === null || campaign.pack_count === undefined ? null : Number(campaign.pack_count),
    offerToken: campaign.offer_token,
    url: campaignUrl(campaign, env),
    createdAt: campaign.created_at,
    expiresAt: campaignNeverExpires(campaign) ? null : campaign.expires_at,
    neverExpires: campaignNeverExpires(campaign),
    product: campaignProduct(campaign, true),
    isActive: campaignIsActive(campaign),
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
      rewardType: campaignRewardType(campaign),
      percent: campaign.percent === null || campaign.percent === undefined ? null : Number(campaign.percent),
      maxRedemptions: Number(campaign.max_redemptions),
      packCount: campaign.pack_count === null || campaign.pack_count === undefined ? null : Number(campaign.pack_count),
      expiresAt: campaignNeverExpires(campaign) ? null : campaign.expires_at,
      neverExpires: campaignNeverExpires(campaign),
      product: campaignProduct(campaign),
      isActive: campaignIsActive(campaign),
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
async function account(member, count, env, seller = null) {
  const tier = [...TIERS].reverse().find(t => count >= t.threshold);
  const next = TIERS.find(t => t.threshold > count);
  const invite = await inviteDetailsFor(member, env);
  const admin = isAdmin(member, env);
  const sellerAccess = admin || seller?.status === "active";
  const sellerStatus = admin ? "owner" : (seller?.status || "not_applied");
  const roles = admin ? ["buyer", "seller", "master"] : (sellerAccess ? ["buyer", "seller"] : ["buyer"]);
  return {
    deviceVerified: Boolean(member.device_verified), profileComplete: member.identity_status === "verified", identityStatus: member.identity_status,
    passwordConfigured: Boolean(member.password_hash && member.password_salt),
    stripeIdentityStatus: member.stripe_identity_status || "not_started", firstName: member.first_name, lastName: member.last_name || "", birthDate: member.birth_date || "",
    hasSellerLegalProfile: Boolean(member.first_name && member.last_name && member.birth_date),
    liveUsername: member.live_username || "", referredSignup: Boolean(member.referred_by_member_id), isAdmin: admin, isMaster: admin,
    sellerAccess, sellerStatus, roles, activePortal: member.active_portal || "buyer",
    phone: member.phone || "", shippingAddress: (() => { try { return JSON.parse(member.shipping_address_json || "{}"); } catch { return {}; } })(),
    paymentMethod: member.stripe_payment_method_id ? { brand: member.stripe_payment_method_brand || "card", last4: member.stripe_payment_method_last4 || "" } : null,
    inviteCode: invite.ownerDashboardOnly ? "" : member.invite_code, inviteDisplayCode: invite.displayCode, inviteUrl: invite.url,
    rotatingReferral: invite.rotating, ownerReferralDashboardOnly: invite.ownerDashboardOnly,
    inviteStartsAt: invite.startsAt, inviteExpiresAt: invite.expiresAt,
    inviteWindowLabel: invite.windowLabel, inviteNextBoundaryLabel: invite.nextBoundaryLabel, serverNow: invite.serverNow,
    referralCount: count, tier, tiers: TIERS,
    nextTier: next ? { ...next, remaining: next.threshold - count } : null
  };
}
async function accountFor(member, env) {
  const [row, seller] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) count FROM members WHERE referred_by_member_id=? AND referral_qualified_at IS NOT NULL`).bind(member.id).first(),
    env.DB.prepare(`SELECT status FROM breaker_profiles WHERE member_id=?`).bind(member.id).first()
  ]);
  return account(member, Number(row?.count || 0), env, seller);
}
async function audit(env, request, type, memberId = null, detail = "") {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  await env.DB.prepare(`INSERT INTO audit_events(id,member_id,type,ip_hash,detail,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), memberId, type, await hash(ip, env.AUTH_SECRET), detail.slice(0, 500), now()).run();
}
async function receiveDeliveredSellerOrder(env, order) {
  if (!order?.id || !order?.member_id) return;
  const seller = await env.DB.prepare(`SELECT status FROM breaker_profiles WHERE member_id=?`).bind(order.member_id).first();
  if (seller?.status !== "active") return;
  let items = [];
  try { items = JSON.parse(order.items_json || "[]"); } catch {}
  for (const line of items) {
    const sourceId = String(line.inventoryItemId || ""); const quantity = Number(line.quantity || 0);
    if (!/^[0-9a-f-]{36}$/i.test(sourceId) || !Number.isInteger(quantity) || quantity < 1) continue;
    const inventory = await env.DB.prepare(`SELECT * FROM breaker_inventory_items WHERE member_id=? AND source_inventory_item_id=? AND unit_type='sealed_box'`).bind(order.member_id, sourceId).first();
    if (!inventory) continue;
    const already = await env.DB.prepare(`SELECT id FROM breaker_inventory_movements WHERE source_order_id=? AND breaker_inventory_item_id=? AND movement_type='received'`).bind(order.id, inventory.id).first();
    if (already) continue;
    const resulting = Number(inventory.quantity) + quantity; const stamp = now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=?,inbound_quantity=MAX(0,inbound_quantity-?),updated_at=? WHERE id=? AND member_id=?`).bind(resulting, quantity, stamp, inventory.id, order.member_id),
      env.DB.prepare(`INSERT INTO breaker_inventory_movements(id,breaker_inventory_item_id,member_id,source_order_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id(), inventory.id, order.member_id, order.id, "received", quantity, resulting, "Automatically received after carrier delivery", stamp)
    ]);
  }
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
  if (url.pathname === "/health") return response({ ok: true, service: "crackpacks-rewards", version: VERSION, identityMode: env.IDENTITY_MODE, storeMode: String(env.STORE_COMING_SOON || "true") === "false" ? "live" : "coming_soon" }, 200, cors);
  const platformResponse = await handlePlatformRoute(request, env, cors);
  if (platformResponse) return platformResponse;
  if (url.pathname === "/webhooks/easypost" && request.method === "POST") {
    if (!env.EASYPOST_WEBHOOK_SECRET) return response({ error: "Tracking webhook is not configured." }, 503, cors);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 1_000_000) return response({ error: "Webhook body is too large." }, 413, cors);
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return response({ error: "Webhook body is too large." }, 413, cors);
    const signedPath = request.headers.get("x-path") || "";
    if (signedPath !== url.pathname) return response({ error: "Invalid webhook signature." }, 401, cors);
    const verification = await verifyEasyPostWebhook({
      secret: env.EASYPOST_WEBHOOK_SECRET,
      timestamp: request.headers.get("x-timestamp") || "",
      path: signedPath,
      signature: request.headers.get("x-hmac-signature-v2") || "",
      method: request.method,
      rawBody
    });
    if (!verification.ok) return response({ error: "Invalid webhook signature." }, 401, cors);
    let event;
    try { event = JSON.parse(rawBody); } catch { return response({ error: "Invalid webhook event." }, 400, cors); }
    const eventId = clean(event?.id, 100);
    const description = clean(event?.description, 100);
    const mode = event?.mode === "production" ? "production" : "test";
    if (!eventId || !description || !/^[a-z0-9_]+$/i.test(eventId)) return response({ error: "Invalid webhook event." }, 400, cors);
    const tracker = ["tracker.created", "tracker.updated"].includes(description) ? sanitizeEasyPostTracker(event?.result) : null;
    const receivedAt = now();
    const previous = await env.DB.prepare(`SELECT processed_at FROM easypost_webhook_events WHERE event_id=?`).bind(eventId).first();
    if (previous?.processed_at) return response({ ok: true, duplicate: true }, 200, cors);
    await env.DB.prepare(`INSERT OR IGNORE INTO easypost_webhook_events(event_id,description,mode,tracker_id,received_at) VALUES(?,?,?,?,?)`).bind(eventId, description, mode, tracker?.id || null, receivedAt).run();
    if (tracker) {
      const updatedAt = now();
      const trackedOrder = await env.DB.prepare(`SELECT orders.id,orders.member_id,orders.order_number,orders.status,orders.items_json,members.email FROM order_shipments shipment JOIN member_orders orders ON orders.id=shipment.order_id JOIN members ON members.id=orders.member_id WHERE shipment.easypost_tracker_id=? LIMIT 1`).bind(tracker.id).first();
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE order_shipments SET mode=?,carrier=?,tracking_code=?,status=?,status_detail=?,estimated_delivery_date=?,carrier_public_url=?,tracking_details_json=?,updated_at=?
          WHERE easypost_tracker_id=?
        `).bind(tracker.mode, tracker.carrier, tracker.trackingCode, tracker.status, tracker.statusDetail, tracker.estimatedDeliveryDate, tracker.publicUrl, JSON.stringify(tracker.details), updatedAt, tracker.id),
        env.DB.prepare(`
          UPDATE member_orders SET status=CASE
            WHEN ?='delivered' THEN 'delivered'
            WHEN ? IN ('pre_transit','unknown','error') THEN status
            ELSE 'shipped' END,updated_at=?
          WHERE id=(SELECT order_id FROM order_shipments WHERE easypost_tracker_id=? LIMIT 1)
        `).bind(tracker.status, tracker.status, updatedAt, tracker.id)
      ]);
      if (tracker.status === "delivered") await receiveDeliveredSellerOrder(env, trackedOrder);
      if (trackedOrder?.email) {
        const becameDelivered = tracker.status === "delivered" && trackedOrder.status !== "delivered";
        const becameShipped = !["pre_transit","unknown","error","delivered"].includes(tracker.status) && !["shipped","delivered"].includes(trackedOrder.status);
        if (becameDelivered || becameShipped) {
          const title = becameDelivered ? `Order ${trackedOrder.order_number} delivered` : `Order ${trackedOrder.order_number} is on the way`;
          const message = becameDelivered ? "The carrier marked your Crack Packs order delivered." : "Your Crack Packs order has its first carrier movement.";
          const trackingUrl = `${String(env.SITE_URL || "https://crackpacks.com").replace(/\/$/, "")}/tracking.html?order=${encodeURIComponent(trackedOrder.id)}`;
          try { await sendEmail(env, trackedOrder.email, title, `<h1>${title}</h1><p>${message}</p><p><a href="${trackingUrl}">Open private tracking</a></p>`, `tracking-${eventId}`, "orders@crackpacks.com"); }
          catch (error) { console.error("Tracking email failed", { eventId, message: error.message }); }
        }
      }
    }
    await env.DB.prepare(`UPDATE easypost_webhook_events SET processed_at=? WHERE event_id=?`).bind(now(), eventId).run();
    return response({ ok: true }, 200, cors);
  }
  if (url.pathname === "/store/inventory" && request.method === "GET") {
    const storeMember = await memberFromRequest(request, env);
    const seller = storeMember ? await env.DB.prepare(`SELECT status FROM breaker_profiles WHERE member_id=?`).bind(storeMember.id).first() : null;
    if (!storeMember) return response({ error: "Sign in to the Seller Portal to view store inventory." }, 401, cors);
    if (storeMember.identity_status !== "verified" || (!isAdmin(storeMember, env) && seller?.status !== "active") || storeMember.active_portal !== "seller") return response({ error: "Active Seller Portal access is required." }, 403, cors);
    const market = url.searchParams.get("market") === "international" ? "international" : "us";
    const currency = String(url.searchParams.get("currency") || "USD").trim().toUpperCase();
    if (!STORE_CURRENCIES.has(currency)) return response({ error: "Choose a supported display currency." }, 400, cors);
    const inventoryEpoch = now();
    const rows = await env.DB.prepare(`
      SELECT i.*,COALESCE((
        SELECT SUM(
          CASE
            WHEN campaign.is_active=1 AND campaign.expires_at>? THEN
              MAX(campaign.max_redemptions - (
                SELECT COUNT(*) FROM campaign_redemptions fulfilled
                WHERE fulfilled.campaign_id=campaign.id AND fulfilled.redeemed_at IS NOT NULL
              ),0)
            ELSE (
              SELECT COUNT(*) FROM campaign_redemptions promised
              WHERE promised.campaign_id=campaign.id AND promised.redeemed_at IS NULL
            )
          END
        )
        FROM offer_campaigns campaign WHERE campaign.inventory_item_id=i.id
      ),0) committed_units
      FROM inventory_items i
      JOIN members owner ON owner.id=i.owner_member_id
      WHERE lower(owner.email)=? AND i.is_store_visible=1 AND i.is_active=1
      ORDER BY CASE WHEN i.quantity>0 THEN 0 ELSE 1 END,i.created_at DESC,i.name COLLATE NOCASE
      LIMIT 200
    `).bind(inventoryEpoch, normalizeEmail(env.ADMIN_EMAIL)).all();
    let fx = null;
    let currencyWarning = "";
    try { fx = await ecbFxQuote(currency); }
    catch { currencyWarning = "Display conversion is temporarily unavailable; USD remains the source price."; }
    const liveRows = rows.results || [];
    const storeRows = liveRows.length ? liveRows : STARTER_INVENTORY.map(item => ({
      public_slug: item.publicSlug, name: item.name, category: item.category,
      description: "Verified current-product preview. Availability, COGS, packed shipping details, and sale price have not been configured yet.",
      image_url: item.imageUrl, source_url: item.sourceUrl, quantity: 0, average_msrp_cents: item.averageMsrpCents,
      reference_price_label: "Retailer list price", reference_price_observed_at: "2026-07-18",
      cogs_cents: null, us_shipping_cents: null, profit_cents: 1000, weight_oz: null, length_in: null, width_in: null, height_in: null,
      origin_country: "", hs_code: ""
    }));
    const comingSoon = String(env.STORE_COMING_SOON || "true") !== "false";
    return response({
      ok: true,
      market,
      baseCurrency: "USD",
      displayCurrency: currency,
      rate: fx,
      currencyWarning,
      comingSoon,
      checkoutEnabled: !comingSoon && String(env.STORE_CHECKOUT_ENABLED || "false") === "true",
      catalogSource: liveRows.length ? "owner_inventory" : "verified_starter_preview",
      items: storeRows.map(row => publicStoreItem(row, market, currency, fx)),
      pricingDisclosure: market === "us"
        ? "USA item prices include the configured shipping allowance. Carrier adjustments and payment fees can change the final margin."
        : "International item prices exclude shipping. Converted amounts are estimates from ECB reference rates; checkout and card-issuer conversion may differ.",
      dutiesDisclosure: market === "international" ? "International orders ship DAP (formerly DDU). The recipient pays destination duties, taxes, customs, brokerage, clearance, and carrier collection fees." : ""
    }, 200, cors);
  }
  if (url.pathname === "/store/shipping-quote" && request.method === "POST") {
    const storeMember = await memberFromRequest(request, env);
    const seller = storeMember ? await env.DB.prepare(`SELECT status FROM breaker_profiles WHERE member_id=?`).bind(storeMember.id).first() : null;
    if (!storeMember) return response({ error: "Sign in to the Seller Portal to request shipping." }, 401, cors);
    if (storeMember.identity_status !== "verified" || (!isAdmin(storeMember, env) && seller?.status !== "active") || storeMember.active_portal !== "seller") return response({ error: "Active Seller Portal access is required." }, 403, cors);
    if (String(env.STORE_COMING_SOON || "true") !== "false" || String(env.STORE_CHECKOUT_ENABLED || "false") !== "true") {
      return response({ error: "Live carrier quotes are not enabled while the store is marked Coming Soon.", code: "SHIPPING_NOT_CONFIGURED" }, 503, cors);
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 8000) return response({ error: "Shipping quote request is too large." }, 413, cors);
    const data = await body(request);
    if (!await verifyTurnstile(env, data?.turnstileToken, request)) return response({ error: "Complete the security check before requesting a shipping quote." }, 403, cors);
    const slug = String(boundedString(data?.slug, 160) || "").trim().toLowerCase();
    const quantity = data?.quantity;
    if (!/^[a-z0-9][a-z0-9-]{2,159}$/.test(slug)) return response({ error: "Choose a valid store product." }, 400, cors);
    if (!Number.isInteger(quantity) || quantity !== 1) return response({ error: "Phase-one carrier quotes support one packed item at a time." }, 400, cors);
    const parsedAddress = parseShippingAddress(data?.address);
    if (parsedAddress.error) return response({ error: parsedAddress.error }, 400, cors);
    const address = parsedAddress.address;
    const quoteEpoch = now();
    const item = await env.DB.prepare(`
      SELECT i.*,COALESCE((
        SELECT SUM(
          CASE
            WHEN campaign.is_active=1 AND campaign.expires_at>? THEN
              MAX(campaign.max_redemptions - (
                SELECT COUNT(*) FROM campaign_redemptions fulfilled
                WHERE fulfilled.campaign_id=campaign.id AND fulfilled.redeemed_at IS NOT NULL
              ),0)
            ELSE (
              SELECT COUNT(*) FROM campaign_redemptions promised
              WHERE promised.campaign_id=campaign.id AND promised.redeemed_at IS NULL
            )
          END
        ) FROM offer_campaigns campaign WHERE campaign.inventory_item_id=i.id
      ),0) committed_units
      FROM inventory_items i JOIN members owner ON owner.id=i.owner_member_id
      WHERE i.public_slug=? AND i.is_store_visible=1 AND i.is_active=1 AND lower(owner.email)=?
    `).bind(quoteEpoch, slug, normalizeEmail(env.ADMIN_EMAIL)).first();
    if (!item) return response({ error: "Store product not found." }, 404, cors);
    if (Number(item.quantity || 0) - Number(item.committed_units || 0) < quantity) return response({ error: "This product is not currently available." }, 409, cors);
    const market = address.country === "US" ? "us" : "international";
    const ipHash = await hash(request.headers.get("CF-Connecting-IP") || "", env.AUTH_SECRET);
    const rateWindow = new Date(Date.now() - 10 * 60e3).toISOString();
    await audit(env, request, "store_shipping_quote_attempt", null, `${item.public_slug}|${market}`);
    const recent = await env.DB.prepare(`SELECT COUNT(*) count FROM audit_events WHERE type='store_shipping_quote_attempt' AND ip_hash=? AND created_at>?`).bind(ipHash, rateWindow).first();
    if (Number(recent?.count || 0) > 10) return response({ error: "Too many shipping quotes were requested. Wait a few minutes and try again." }, 429, cors);
    let quoted;
    try { quoted = await easyPostShipmentQuote(env, item, quantity, address); }
    catch (error) {
      const messages = {
        SHIPPING_NOT_CONFIGURED: "Live carrier quotes are not configured yet.", SHIP_FROM_NOT_CONFIGURED: "The store ship-from address is not configured yet.",
        PACKAGE_NOT_CONFIGURED: "This product still needs packed weight and dimensions.", CUSTOMS_NOT_CONFIGURED: "This product still needs origin-country and customs information.",
        MULTI_ITEM_PACKING_NOT_READY: "Multi-item packing is not enabled yet.", NO_SHIPPING_RATES: "No carrier rates were returned for that address.",
        SHIPPING_PROVIDER_ERROR: "The carrier rating service could not prepare a quote. Check the address and try again."
      };
      return response({ error: messages[error.message] || "The shipping quote could not be prepared.", code: error.message }, error.message === "NO_SHIPPING_RATES" ? 422 : 503, cors);
    }
    const quoteId = id();
    const createdAt = now();
    const expiresAt = new Date(Date.now() + STORE_QUOTE_TTL_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM shipping_quotes WHERE expires_at<=?`).bind(createdAt),
      env.DB.prepare(`INSERT INTO shipping_quotes(id,inventory_item_id,quantity,market,destination_country,address_hash,easypost_shipment_id,rates_json,expires_at,created_at,address_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
        quoteId, item.id, quantity, market, address.country, await hash(JSON.stringify(address), env.AUTH_SECRET), quoted.shipmentId, JSON.stringify(quoted.rates), expiresAt, createdAt, JSON.stringify(address)
      )
    ]);
    await audit(env, request, "store_shipping_quote", null, `${item.public_slug}|${market}|${quoted.shipmentId}`);
    return response({
      ok: true, quoteId, expiresAt, currency: "USD", rates: quoted.rates,
      disclosure: market === "international"
        ? "Live carrier quote for transportation only. International orders ship DAP (formerly DDU); the recipient pays destination duties, taxes, customs, brokerage, clearance, and carrier collection fees. Carrier adjustments can apply if the final parcel differs."
        : "Live carrier quote based on the configured packed size and destination. Carrier adjustments can apply if the final parcel differs."
    }, 200, cors);
  }
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
      const credentialValid = Boolean(owner && await verifyOwnerReferral(ownerToken, env.SITE_URL, owner.id, env.OWNER_REFERRAL_SECRET, epochMs));
      const isActive = Boolean(credentialValid && await ownerReferralIsActive(env, owner.id, slot.id));
      return response({ valid: isActive, rotating: true, isActive, expiresAt: slot.expiresAt, windowLabel: slot.label, nextBoundaryLabel: slot.nextBoundaryLabel, serverNow, reason: isActive ? "current" : credentialValid ? "disabled" : "expired" }, 200, cors);
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
  if (url.pathname === "/public/owner-referral" && request.method === "GET") {
    const fallbackSignupUrl = `${env.SITE_URL}/referral.html?mode=signup`;
    const owner = normalizeEmail(env.ADMIN_EMAIL)
      ? await env.DB.prepare(`SELECT id,email FROM members WHERE email=? AND identity_status='verified'`).bind(normalizeEmail(env.ADMIN_EMAIL)).first()
      : null;
    if (!owner) return response({ ok: true, signupUrl: fallbackSignupUrl, sellerSignupUrl: fallbackSignupUrl, active: false }, 200, cors);
    const epochMs = Date.now();
    const slot = ownerReferralSlotAt(epochMs);
    const active = await ownerReferralIsActive(env, owner.id, slot.id);
    const issued = await issueOwnerReferral(env.SITE_URL, owner.id, env.OWNER_REFERRAL_SECRET, epochMs);
    const signupUrl = active ? `${issued.url}&mode=signup` : fallbackSignupUrl;
    return response({
      ok: true,
      signupUrl,
      sellerSignupUrl: signupUrl,
      active,
      expiresAt: issued.expiresAt,
      windowLabel: issued.label,
      nextBoundaryLabel: issued.nextBoundaryLabel
    }, 200, cors);
  }
  if (url.pathname === "/auth/request" && request.method === "POST") {
    const data = await body(request); const email = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Enter a valid email address." }, 400, cors);
    const returnTo = data.returnTo === "admin" ? "admin" : "rewards";
    const requestedAuthFlow = returnTo === "admin" ? "admin" : data.authMode === "signup" ? "signup" : "signin";
    if (!await verifyTurnstile(env, data.turnstileToken, request)) return response({ error: "Security check failed. Refresh the page and try again." }, 403, cors);
    const existingMember = await env.DB.prepare(`SELECT id FROM members WHERE email=?`).bind(email).first();
    const authFlow = requestedAuthFlow === "admin" ? "admin" : existingMember ? "signin" : "signup";
    const emailKey = await hash(email, env.AUTH_SECRET);
    const currentTime = now();
    await env.DB.prepare(`DELETE FROM login_codes WHERE email=? AND (used_at IS NOT NULL OR expires_at<=?)`).bind(email, currentTime).run();
    const activeCodes = await env.DB.prepare(`SELECT expires_at FROM login_codes WHERE email=? AND used_at IS NULL AND expires_at>? ORDER BY expires_at ASC`).bind(email, currentTime).all();
    if ((activeCodes.results || []).length >= 3) {
      const retryAfterSeconds = Math.max(60, Math.ceil((Date.parse(activeCodes.results[0].expires_at) - Date.now()) / 1000));
      return response({ error: "Too many active verification links. Use the newest email link, or wait a few minutes for the older links to expire.", retryAfterSeconds }, 429, { ...cors, "Retry-After": String(retryAfterSeconds) });
    }
    const flowMatches = authFlow === "admin"
      ? Boolean(existingMember) && email === normalizeEmail(env.ADMIN_EMAIL)
      : true;
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
      const slot = ownerReferralSlotAt(Date.now());
      const credentialValid = Boolean(owner && normalizeEmail(owner.email) !== email && await verifyOwnerReferral(ownerReferralToken, env.SITE_URL, owner.id, env.OWNER_REFERRAL_SECRET));
      if (credentialValid && await ownerReferralIsActive(env, owner.id, slot.id)) referrerMemberId = owner.id;
      else ownerReferralRejected = true;
    } else if (ref) {
      const inviter = await env.DB.prepare(`SELECT id,email,identity_status FROM members WHERE invite_code=?`).bind(ref).first();
      if (inviter && isOwnerEmail(inviter, env)) ownerReferralRejected = true;
      else if (inviter?.identity_status === "verified" && normalizeEmail(inviter.email) !== email) referrerMemberId = inviter.id;
    }
    if (ownerReferralRejected) return response({ error: "This owner referral window has expired. Ask for the current QR or referral link." }, 410, cors);
    const destinationPath = returnTo === "admin" ? "/admin.html" : "/referral.html";
    const verifyParams = new URLSearchParams({ verify: linkToken, mode: authFlow });
    const sellerActivationToken = boundedString(data.sellerActivationToken, 120);
    if (sellerActivationToken === null) return response({ error: "Invalid seller activation credential." }, 400, cors);
    if (sellerActivationToken) {
      const activation = await env.DB.prepare(`SELECT target_email,target_member_id FROM breaker_activation_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?`).bind(await hash(sellerActivationToken, env.AUTH_SECRET), now()).first();
      const activationMatches = Boolean(activation && normalizeEmail(activation.target_email) === email && (!activation.target_member_id || activation.target_member_id === existingMember?.id));
      if (!activationMatches) return response({ error: "That seller activation link is invalid, expired, or belongs to another account." }, 403, cors);
      verifyParams.set("seller_activation", sellerActivationToken);
    }
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
        return { ok: true, delivered: false, flowMismatch: true };
      }
      try {
        await sendEmail(env, email, emailCopy.subject, `<h1>${emailCopy.heading}</h1><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:14px 22px;background:#f8ff46;color:#070815;text-decoration:none;font-weight:bold;border-radius:10px">${emailCopy.button}</a></p><p>This secure link expires in 10 minutes and can only be used once. If you did not request it, ignore this message.</p>`, codeId);
        await audit(env, request, `${authFlow}_link_requested`, null, emailKey);
        return { ok: true, delivered: true };
      } catch (error) {
        console.error("Authentication email delivery failed", { flow: authFlow, codeId });
        await env.DB.prepare(`DELETE FROM login_codes WHERE id=?`).bind(codeId).run();
        await audit(env, request, "auth_email_delivery_failed", null, emailKey);
        throw error;
      }
    };
    let authResult;
    try {
      authResult = await finishAuthRequest();
    } catch (error) {
      if (error.message === "EMAIL_NOT_CONFIGURED") return response({ error: "Account email is not configured on the rewards service yet." }, 503, cors);
      if (error.message === "EMAIL_DELIVERY_FAILED") return response({ error: "The verification email could not be sent right now. Try again in a minute." }, 502, cors);
      throw error;
    }
    return response({ ok: true, authFlow, delivered: Boolean(authResult?.delivered) }, 200, cors);
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
        await env.DB.prepare(`INSERT INTO members(id,email,email_verified_at,invite_code,referred_by_member_id,referral_qualified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(memberId, email, created, inviteCode, referrerMemberId, referrerMemberId ? created : null, created, created).run();
      } catch (error) {
        return response({ error: "An account already exists for this email. Return to Profile and choose Sign In." }, 409, cors);
      }
      member = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(memberId).first();
      if (referrerMemberId) {
        await audit(env, request, "referral_credit_awarded", referrerMemberId, `${member.id}|${member.email}|first_signin`);
      }
    }
    const token = await issueMemberSession(env, member.id);
    await audit(env, request, "email_link_verified", member.id, authFlow); return response({ token, authFlow, account: await accountFor(member, env) }, 200, cors);
  }
  if (url.pathname === "/auth/password/login" && request.method === "POST") {
    const data = await body(request);
    const email = normalizeEmail(data.email);
    const password = String(data.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Enter a valid email address." }, 400, cors);
    if (!await verifyTurnstile(env, data.turnstileToken, request)) return response({ error: "Security check failed. Refresh the page and try again." }, 403, cors);
    const member = await env.DB.prepare(`SELECT * FROM members WHERE email=?`).bind(email).first();
    const generic = { error: "Email or password is incorrect." };
    if (!member || !member.email_verified_at || !member.password_hash || !member.password_salt) return response(generic, 401, cors);
    if (member.password_locked_until && member.password_locked_until > now()) return response({ error: "Too many password attempts. Try again later." }, 429, cors);
    const digest = await passwordDigest(password, member.password_salt, env.AUTH_SECRET);
    if (digest !== member.password_hash) {
      const attempts = Number(member.password_failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 8 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
      await env.DB.prepare(`UPDATE members SET password_failed_attempts=?,password_locked_until=?,updated_at=? WHERE id=?`).bind(attempts, lockedUntil, now(), member.id).run();
      await audit(env, request, "password_login_failed", member.id);
      return response(lockedUntil ? { error: "Too many password attempts. Try again in 15 minutes." } : generic, lockedUntil ? 429 : 401, cors);
    }
    const token = await issueMemberSession(env, member.id);
    await env.DB.prepare(`UPDATE members SET password_failed_attempts=0,password_locked_until=NULL,updated_at=? WHERE id=?`).bind(now(), member.id).run();
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first();
    await audit(env, request, "password_login_verified", member.id);
    return response({ token, authFlow: "signin", account: await accountFor(updated, env) }, 200, cors);
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
  if (url.pathname === "/auth/password/set" && request.method === "POST") {
    const data = await body(request);
    const passwordError = validatePassword(data.password);
    if (passwordError) return response({ error: passwordError }, 400, cors);
    if (data.password !== data.confirmPassword) return response({ error: "Passwords do not match." }, 400, cors);
    const record = await newPasswordRecord(data.password, env.AUTH_SECRET);
    await env.DB.prepare(`UPDATE members SET password_hash=?,password_salt=?,password_updated_at=?,password_failed_attempts=0,password_locked_until=NULL,updated_at=? WHERE id=?`).bind(record.digest, record.salt, now(), now(), member.id).run();
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first();
    await audit(env, request, "password_set", member.id);
    return response({ account: await accountFor(updated, env) }, 200, cors);
  }
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
    if (member.identity_status === "verified") return response({ error: "Your identity profile is already verified. Use profile settings to update your User ID." }, 409, cors);
    const data = await body(request); const first = clean(data.firstName, 60), last = clean(data.lastName, 60), birth = clean(data.birthDate, 10);
    if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(birth) || data.consent !== "on") return response({ error: "Complete every legal identity field and consent checkbox." }, 400, cors);
    const birthDate = new Date(`${birth}T00:00:00Z`);
    if (!Number.isFinite(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== birth) return response({ error: "Enter a valid calendar date of birth." }, 400, cors);
    const age = (Date.now() - birthDate.getTime()) / 31557600000;
    if (age < 18 || age > 120) return response({ error: "Rewards accounts require a valid adult date of birth." }, 400, cors);
    const fingerprint = await hash(`${first.toLowerCase()}|${last.toLowerCase()}|${birth}`, env.IDENTITY_PEPPER || env.AUTH_SECRET);
    const rows = await env.DB.prepare(`SELECT id,identity_fingerprint FROM members WHERE id<>?`).bind(member.id).all();
    const duplicate = (rows.results || []).find(row => row.identity_fingerprint === fingerprint);
    if (duplicate) {
      const stamp = now();
      const pendingReview = await env.DB.prepare(`SELECT id FROM identity_review_queue WHERE member_id=? AND conflicting_member_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`).bind(member.id, duplicate.id).first();
      if (pendingReview) return response({ error: "This legal identity is already connected to an existing account. Owner review is required." }, 409, cors);
      const exceptionFingerprint = await hash(`approved-duplicate|${fingerprint}|${member.id}`, env.IDENTITY_PEPPER || env.AUTH_SECRET);
      await env.DB.batch([
        env.DB.prepare(`UPDATE members SET first_name=?,last_name=?,birth_date=?,identity_fingerprint=?,identity_status='manual_review',stripe_identity_status='manual_review',updated_at=? WHERE id=?`).bind(first, last, birth, exceptionFingerprint, stamp, member.id),
        env.DB.prepare(`INSERT INTO identity_review_queue(id,member_id,conflicting_member_id,reason,detail,created_at) VALUES(?,?,?,?,?,?)`).bind(id(), member.id, duplicate.id, "signup_collision", "Protected legal identity matches another account. Master may approve the single normal-seller exception.", stamp)
      ]);
      await audit(env, request, "duplicate_identity_blocked", member.id);
      return response({ error: "This legal identity is already connected to an existing account. Owner review is required." }, 409, cors);
    }
    const identityStatus = "pending_identity";
    await env.DB.prepare(`UPDATE members SET first_name=?,last_name=?,birth_date=?,identity_fingerprint=?,identity_status=?,stripe_identity_status='not_started',referral_qualified_at=NULL,updated_at=? WHERE id=?`).bind(first, last, birth, fingerprint, identityStatus, now(), member.id).run();
    const updated = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(member.id).first(); await audit(env, request, "profile_submitted", member.id, identityStatus);
    return response({ account: await accountFor(updated, env), identityVerificationRequired: true }, 200, cors);
  }
  if (member.identity_status !== "verified") return response({ error: "Complete Stripe Identity verification first." }, 403, cors);
  if (url.pathname === "/orders/mine" && request.method === "GET") {
    const rows = await env.DB.prepare(`${orderSelectSql} WHERE orders.member_id=? ORDER BY orders.placed_at DESC LIMIT 100`).bind(member.id).all();
    return response({ orders: (rows.results || []).map(row => orderView(row, env)), serverNow: now() }, 200, cors);
  }
  const memberTrackingMatch = url.pathname.match(/^\/orders\/([0-9a-f-]{36})\/tracking$/i);
  if (memberTrackingMatch && request.method === "GET") {
    const row = await env.DB.prepare(`${orderSelectSql} WHERE orders.id=? AND orders.member_id=? LIMIT 1`).bind(memberTrackingMatch[1], member.id).first();
    if (!row) return response({ error: "Order tracking was not found for this account." }, 404, cors);
    return response({ order: orderView(row, env), serverNow: now() }, 200, cors);
  }
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
    if (!campaignIsActive(campaign)) return response({ error: "This campaign QR has been turned off by Crack Packs." }, 410, cors);
    const loadMemberClaim = () => env.DB.prepare(`
      SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot
      FROM campaign_redemptions cr JOIN offer_campaigns c ON c.id=cr.campaign_id
      WHERE cr.campaign_id=? AND cr.member_id=?
    `).bind(campaign.id, member.id).first();
    let existingClaim = await loadMemberClaim();
    if (existingClaim) return response(campaignClaimPayload(existingClaim, true, claimedAt, week), 200, cors);
    if (!campaignNeverExpires(campaign) && campaign.expires_at <= claimedAt) return response({ error: "This campaign has expired." }, 410, cors);
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
        WHERE c.id=? AND c.owner_member_id<>? AND c.is_active=1 AND c.expires_at>?
          AND (SELECT COUNT(*) FROM campaign_redemptions capacity WHERE capacity.campaign_id=c.id) < c.max_redemptions
          AND (? IS NULL OR (c.reward_type='pack_draft' AND ? BETWEEN 1 AND c.pack_count AND NOT EXISTS (SELECT 1 FROM campaign_redemptions packs WHERE packs.campaign_id=c.id AND packs.pack_number=?)))
      `).bind(redemptionId, member.id, week.key, code, packNumber, claimedAt, campaign.id, member.id, claimedAt, packNumber, packNumber, packNumber).run();
      if (Number(inserted.meta?.changes || 0) === 1) {
        const claim = await env.DB.prepare(`
          SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot
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
      const currentCampaign = await env.DB.prepare(`SELECT is_active FROM offer_campaigns WHERE id=?`).bind(campaign.id).first();
      if (!currentCampaign || Number(currentCampaign.is_active) !== 1) return response({ error: "This campaign QR has been turned off by Crack Packs." }, 410, cors);
      if (!campaignNeverExpires(campaign) && campaign.expires_at <= now()) return response({ error: "This campaign has expired." }, 410, cors);
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
        SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot
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
  if (url.pathname === "/admin/referral/status" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    if (typeof data?.active !== "boolean") return response({ error: "Choose whether the current owner referral QR is active." }, 400, cors);
    const epochMs = Date.now();
    const slot = ownerReferralSlotAt(epochMs);
    const updatedAt = new Date(epochMs).toISOString();
    if (data.active) {
      await env.DB.prepare(`DELETE FROM owner_referral_controls WHERE owner_member_id=? AND slot_id=?`).bind(member.id, slot.id).run();
    } else {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO owner_referral_controls(owner_member_id,slot_id,is_active,updated_at) VALUES(?,?,0,?) ON CONFLICT(owner_member_id,slot_id) DO UPDATE SET is_active=0,updated_at=excluded.updated_at`).bind(member.id, slot.id, updatedAt),
        env.DB.prepare(`UPDATE login_codes SET used_at=? WHERE referrer_member_id=? AND used_at IS NULL AND expires_at>?`).bind(updatedAt, member.id, updatedAt)
      ]);
    }
    await audit(env, request, data.active ? "owner_referral_enabled" : "owner_referral_disabled", member.id, slot.id);
    return response({ current: await inviteDetailsFor(member, env, epochMs, true) }, 200, cors);
  }
  if (url.pathname === "/admin/referral/qr" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    if (boundedString(data?.inviteUrl, 512) === null) return response({ error: "Invalid referral address." }, 400, cors);
    const invite = await inviteDetailsFor(member, env, Date.now(), true);
    if (String(data.inviteUrl || "") !== invite.url) return response({ error: "That referral window changed. Refresh the current link before generating its QR." }, 409, cors);
    return svgResponse(await referralQrSvg(invite.url), cors);
  }
  if (url.pathname === "/admin/shipping/test" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    if (!env.EASYPOST_TEST_API_KEY) return response({ error: "The EasyPost test API key is not configured." }, 503, cors);
    const sampleItem = { weight_oz: 8, length_in: 6, width_in: 4, height_in: 2 };
    const sampleDestination = {
      name: "EasyPost Test",
      street1: "417 Montgomery Street",
      street2: "5th Floor",
      city: "San Francisco",
      state: "CA",
      postalCode: "94104",
      country: "US",
      phone: "4153334445",
      email: "support@easypost.com"
    };
    let quoted;
    try { quoted = await easyPostShipmentQuote(env, sampleItem, 1, sampleDestination, env.EASYPOST_TEST_API_KEY); }
    catch (error) {
      const messages = {
        SHIP_FROM_NOT_CONFIGURED: "The stored ship-from address is missing or invalid JSON.",
        NO_SHIPPING_RATES: "EasyPost accepted the request but returned no test carrier rates.",
        SHIPPING_PROVIDER_ERROR: "EasyPost rejected the test request. Recheck the test API key, wallet, ship-from address, and enabled carriers."
      };
      await audit(env, request, "easypost_test_failed", member.id, error.message);
      return response({ error: messages[error.message] || "The EasyPost test could not be completed.", code: error.message }, 503, cors);
    }
    if (quoted.mode !== "test") {
      await audit(env, request, "easypost_test_failed", member.id, "unexpected-mode");
      return response({ error: "EasyPost did not return a test-mode shipment. No label was purchased." }, 503, cors);
    }
    await audit(env, request, "easypost_test_passed", member.id, `${quoted.shipmentId}|rates:${quoted.rates.length}`);
    return response({
      ok: true,
      mode: "test",
      labelPurchased: false,
      sampleParcel: "8 oz · 6 × 4 × 2 in",
      rates: quoted.rates.slice(0, 6)
    }, 200, cors);
  }
  if (url.pathname === "/admin/inventory" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const query = clean(url.searchParams.get("q"), 100).toLowerCase().replace(/[^a-z0-9._+&' -]/g, "");
    const search = `%${query}%`;
    const availableOnly = url.searchParams.get("available") === "1";
    const inventoryEpoch = now();
    const rows = await env.DB.prepare(`
      SELECT inventory.*,COALESCE((
        SELECT SUM(
          CASE
            WHEN campaign.is_active=1 AND campaign.expires_at>? THEN
              MAX(campaign.max_redemptions - (
                SELECT COUNT(*) FROM campaign_redemptions fulfilled
                WHERE fulfilled.campaign_id=campaign.id AND fulfilled.redeemed_at IS NOT NULL
              ),0)
            ELSE (
              SELECT COUNT(*) FROM campaign_redemptions promised
              WHERE promised.campaign_id=campaign.id AND promised.redeemed_at IS NULL
            )
          END
        ) FROM offer_campaigns campaign WHERE campaign.inventory_item_id=inventory.id
      ),0) committed_units
      FROM inventory_items inventory
      WHERE owner_member_id=? AND (?=0 OR (is_active=1 AND quantity>0))
        AND (?='' OR lower(name) LIKE ? OR lower(COALESCE(upc,'')) LIKE ? OR lower(category) LIKE ?)
      ORDER BY is_active DESC,CASE WHEN quantity>0 THEN 0 ELSE 1 END,updated_at DESC,name COLLATE NOCASE
      LIMIT 150
    `).bind(inventoryEpoch, member.id, availableOnly ? 1 : 0, query, search, search, search).all();
    let inventory = (rows.results || []).map(inventoryItemView);
    if (availableOnly) inventory = inventory.filter(item => item.campaignReady);
    return response({ inventory }, 200, cors);
  }
  if (url.pathname === "/admin/inventory/catalog/import" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const createdAt = now();
    const statements = STARTER_INVENTORY.map(item => env.DB.prepare(`
      INSERT OR IGNORE INTO inventory_items(
        id,owner_member_id,public_slug,name,upc,category,description,image_url,source_url,quantity,average_msrp_cents,
        reference_price_label,reference_price_observed_at,cogs_cents,us_shipping_cents,profit_cents,weight_oz,length_in,width_in,height_in,
        origin_country,hs_code,packing_notes,is_store_visible,is_active,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id(), member.id, item.publicSlug, item.name, item.upc, item.category,
      "Verified current product starter entry. Add actual stock, landed COGS, packed dimensions, and your own or licensed product photo before selling.",
      item.imageUrl, item.sourceUrl, 0, item.averageMsrpCents, "Retailer list price", "2026-07-18", null, null, 1000,
      null, null, null, null, "", "", "", 1, 1, createdAt, createdAt
    ));
    const results = await env.DB.batch(statements);
    const imported = results.reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
    await audit(env, request, "inventory_catalog_imported", member.id, `imported:${imported}`);
    const rows = await env.DB.prepare(`SELECT * FROM inventory_items WHERE owner_member_id=? ORDER BY updated_at DESC,name COLLATE NOCASE`).bind(member.id).all();
    return response({ imported, inventory: (rows.results || []).map(inventoryItemView) }, imported ? 201 : 200, cors);
  }
  if (url.pathname === "/admin/store-listings" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    const title = clean(data?.title, 120);
    const description = clean(data?.description, 1000);
    const condition = clean(data?.condition, 80);
    const imageUrl = clean(data?.imageUrl, 500);
    const shippingPayer = ["buyer", "seller"].includes(String(data?.shippingPayer || "")) ? String(data.shippingPayer) : "buyer";
    const saleType = ["cards","breaks","singles","sealed","rip_ship","rtyh","buy_ship"].includes(String(data?.saleType || "")) ? String(data.saleType) : "singles";
    const series = ["pokemon", "magic"].includes(String(data?.series || "").toLowerCase()) ? String(data.series).toLowerCase() : "pokemon";
    const quantity = Number(data?.quantity || 1);
    const price = Math.round(Number(data?.price || 0) * 100);
    if (!title || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !Number.isInteger(price) || price < 1 || price > 100000000) {
      return response({ error: "Enter a title, price, and quantity for the Buyer Store listing." }, 400, cors);
    }
    if (imageUrl && !/^https:\/\//i.test(imageUrl) && !/^assets\/images\/[a-z0-9._/-]+$/i.test(imageUrl)) return response({ error: "Listing image must use HTTPS or a local assets/images path." }, 400, cors);
    const createdAt = now();
    const inventoryId = id();
    const listingId = id();
    const showId = null;
    const publicSlug = `${slugify(title)}-${randomString(6).toLowerCase()}`;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO inventory_items(
          id,owner_member_id,public_slug,name,upc,category,series,description,image_url,source_url,quantity,average_msrp_cents,
          reference_price_label,reference_price_observed_at,cogs_cents,us_shipping_cents,profit_cents,weight_oz,length_in,width_in,height_in,
          origin_country,hs_code,packing_notes,is_store_visible,is_active,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        inventoryId, member.id, publicSlug, title, null, saleType, series, description, imageUrl, "", quantity, null,
        "Buyer Store listing", "", null, null, 1000, null, null, null, null, "", "", "", 0, 1, createdAt, createdAt
      ),
      env.DB.prepare(`
        INSERT INTO seller_store_listings(
          id,member_id,show_id,inventory_item_id,title,description,sale_type,item_condition,quantity,price_cents,shipping_payer,image_url,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)
      `).bind(listingId, member.id, showId, inventoryId, title, description, saleType, condition, quantity, price, shippingPayer, imageUrl, createdAt, createdAt)
    ]);
    const savedInventory = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id=? AND owner_member_id=?`).bind(inventoryId, member.id).first();
    await audit(env, request, "admin_store_listing_created", member.id, `${listingId}|${inventoryId}|${series}`);
    return response({ item: inventoryItemView(savedInventory), listingId, marketplace: true }, 201, cors);
  }
  if (url.pathname === "/admin/inventory" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 16000) return response({ error: "Inventory request is too large." }, 413, cors);
    const parsed = parseInventoryItemInput(await body(request));
    if (parsed.error) return response({ error: parsed.error }, 400, cors);
    const item = parsed.item;
    const inventoryId = id();
    const publicSlug = `${slugify(item.name)}-${randomString(6).toLowerCase()}`;
    const createdAt = now();
    try {
      await env.DB.prepare(`
        INSERT INTO inventory_items(
          id,owner_member_id,public_slug,name,upc,category,description,image_url,source_url,quantity,average_msrp_cents,
          reference_price_label,reference_price_observed_at,cogs_cents,us_shipping_cents,profit_cents,
          packaging_cents,overhead_cents,retail_fixed_fee_cents,wholesale_handling_cents,
          retail_list_price_cents,website_list_price_cents,international_list_price_cents,live_list_price_cents,
          wholesale_small_list_price_cents,wholesale_case_list_price_cents,wholesale_pallet_list_price_cents,
          weight_oz,length_in,width_in,height_in,
          origin_country,hs_code,packing_notes,is_store_visible,is_active,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        inventoryId, member.id, publicSlug, item.name, item.upc, item.category, item.description, item.imageUrl, item.sourceUrl, item.quantity,
        item.averageMsrpCents, item.referencePriceLabel, item.referencePriceObservedAt, item.cogsCents, item.usShippingCents, item.profitCents,
        item.packagingCents, item.overheadCents, item.retailFixedFeeCents, item.wholesaleHandlingCents,
        item.retailListPriceCents, item.websiteListPriceCents, item.internationalListPriceCents, item.liveListPriceCents,
        item.wholesaleSmallListPriceCents, item.wholesaleCaseListPriceCents, item.wholesalePalletListPriceCents,
        item.weightOz, item.lengthIn, item.widthIn, item.heightIn, item.originCountry, item.hsCode, item.packingNotes,
        item.isStoreVisible ? 1 : 0, item.isActive ? 1 : 0, createdAt, createdAt
      ).run();
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || ""))) return response({ error: "That UPC, source listing, or public product address is already in inventory." }, 409, cors);
      throw error;
    }
    const saved = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id=? AND owner_member_id=?`).bind(inventoryId, member.id).first();
    await audit(env, request, "inventory_created", member.id, `${inventoryId}|${item.upc || "no-upc"}`);
    return response({ item: inventoryItemView(saved) }, 201, cors);
  }
  const adminInventoryMatch = url.pathname.match(/^\/admin\/inventory\/([0-9a-f-]{36})$/i);
  if (adminInventoryMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const parsed = parseInventoryItemInput(await body(request));
    if (parsed.error) return response({ error: parsed.error }, 400, cors);
    const item = parsed.item;
    const updatedAt = now();
    try {
      const updated = await env.DB.prepare(`
        UPDATE inventory_items SET
          name=?,upc=?,category=?,description=?,image_url=?,source_url=?,quantity=?,average_msrp_cents=?,reference_price_label=?,reference_price_observed_at=?,
          cogs_cents=?,us_shipping_cents=?,profit_cents=?,packaging_cents=?,overhead_cents=?,retail_fixed_fee_cents=?,wholesale_handling_cents=?,
          retail_list_price_cents=?,website_list_price_cents=?,international_list_price_cents=?,live_list_price_cents=?,
          wholesale_small_list_price_cents=?,wholesale_case_list_price_cents=?,wholesale_pallet_list_price_cents=?,
          weight_oz=?,length_in=?,width_in=?,height_in=?,origin_country=?,hs_code=?,packing_notes=?,
          is_store_visible=?,is_active=?,updated_at=?
        WHERE id=? AND owner_member_id=?
      `).bind(
        item.name, item.upc, item.category, item.description, item.imageUrl, item.sourceUrl, item.quantity, item.averageMsrpCents,
        item.referencePriceLabel, item.referencePriceObservedAt, item.cogsCents, item.usShippingCents, item.profitCents,
        item.packagingCents, item.overheadCents, item.retailFixedFeeCents, item.wholesaleHandlingCents,
        item.retailListPriceCents, item.websiteListPriceCents, item.internationalListPriceCents, item.liveListPriceCents,
        item.wholesaleSmallListPriceCents, item.wholesaleCaseListPriceCents, item.wholesalePalletListPriceCents,
        item.weightOz, item.lengthIn, item.widthIn, item.heightIn, item.originCountry, item.hsCode, item.packingNotes,
        item.isStoreVisible ? 1 : 0, item.isActive ? 1 : 0, updatedAt, adminInventoryMatch[1], member.id
      ).run();
      if (Number(updated.meta?.changes || 0) !== 1) return response({ error: "Inventory item not found." }, 404, cors);
    } catch (error) {
      if (/INVENTORY_COMMITMENT_CONFLICT/i.test(String(error?.message || ""))) return response({ error: "Quantity cannot be lower than the product units already reserved by active campaigns or unfulfilled claims." }, 409, cors);
      if (/unique|constraint/i.test(String(error?.message || ""))) return response({ error: "That UPC or source listing is already connected to another inventory item." }, 409, cors);
      throw error;
    }
    const saved = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id=? AND owner_member_id=?`).bind(adminInventoryMatch[1], member.id).first();
    await audit(env, request, "inventory_updated", member.id, `${saved.id}|qty:${saved.quantity}|active:${saved.is_active}`);
    return response({ item: inventoryItemView(saved) }, 200, cors);
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
    const neverExpires = data?.neverExpires === true;
    const expiresInHours = neverExpires ? null : parseCampaignExpiryHours(data?.expiresInHours);
    const maxRedemptions = data?.maxRedemptions;
    if (!title) return response({ error: "Enter a campaign title up to 100 characters." }, 400, cors);
    if (!CAMPAIGN_REWARD_TYPES.has(rewardType)) return response({ error: "Choose a valid campaign reward type." }, 400, cors);
    if (!neverExpires && expiresInHours === null) return response({ error: "Campaign expiration must be between 1 hour and 7 days, or choose Indefinite." }, 400, cors);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > MAX_CAMPAIGN_REDEMPTIONS) return response({ error: `Maximum redemptions must be from 1 to ${MAX_CAMPAIGN_REDEMPTIONS}.` }, 400, cors);
    const storageRewardType = rewardType === "free_single" || rewardType === "product" ? "pick_a_pack" : rewardType;
    const rewardVariant = rewardType === "free_single" ? "free_single" : null;
    let percent = null;
    let packCount = null;
    let inventoryItem = null;
    if (rewardType === "product") {
      const inventoryItemId = String(data?.inventoryItemId || "");
      if (!/^[0-9a-f-]{36}$/i.test(inventoryItemId)) return response({ error: "Choose a product from current inventory." }, 400, cors);
      inventoryItem = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id=? AND owner_member_id=? AND is_active=1`).bind(inventoryItemId, member.id).first();
      if (!inventoryItem || Number(inventoryItem.quantity || 0) < 1) return response({ error: "That inventory product is inactive or has no available quantity." }, 409, cors);
      const committedUnits = await inventoryCommittedUnits(env, inventoryItem.id, member.id);
      const remainingCapacity = Math.max(0, Number(inventoryItem.quantity || 0) - committedUnits);
      if (maxRedemptions > remainingCapacity) return response({ error: `Only ${remainingCapacity} unallocated unit${remainingCapacity === 1 ? " is" : "s are"} available for active product campaigns.` }, 409, cors);
    } else if (data?.inventoryItemId !== undefined && data?.inventoryItemId !== null && data?.inventoryItemId !== "") {
      return response({ error: "Inventory selection is only used for Products campaigns." }, 400, cors);
    }
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
    const expiresAt = neverExpires ? "9999-12-31T23:59:59.999Z" : new Date(epochMs + Math.round(expiresInHours * 3600e3)).toISOString();
    let campaign = null;
    for (let attempt = 0; attempt < 5 && !campaign; attempt += 1) {
      const campaignId = id();
      const offerToken = `OFR${randomString(32)}`;
      const inserted = inventoryItem
        ? await env.DB.prepare(`
          INSERT OR IGNORE INTO offer_campaigns(
            id,owner_member_id,title,reward_type,reward_variant,percent,max_redemptions,pack_count,offer_token,expires_at,never_expires,
            inventory_item_id,product_name_snapshot,product_upc_snapshot,created_at
          )
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          FROM inventory_items inventory
          WHERE inventory.id=? AND inventory.owner_member_id=? AND inventory.is_active=1
            AND inventory.quantity >= ? + COALESCE((
              SELECT SUM(
                CASE
                  WHEN active.is_active=1 AND active.expires_at>? THEN
                    MAX(active.max_redemptions - (
                      SELECT COUNT(*) FROM campaign_redemptions fulfilled
                      WHERE fulfilled.campaign_id=active.id AND fulfilled.redeemed_at IS NOT NULL
                    ),0)
                  ELSE (
                    SELECT COUNT(*) FROM campaign_redemptions promised
                    WHERE promised.campaign_id=active.id AND promised.redeemed_at IS NULL
                  )
                END
              ) FROM offer_campaigns active
              WHERE active.inventory_item_id=inventory.id AND active.owner_member_id=?
            ),0)
        `).bind(
          campaignId, member.id, title, storageRewardType, rewardVariant, percent, maxRedemptions, packCount, offerToken, expiresAt, neverExpires ? 1 : 0,
          inventoryItem.id, inventoryItem.name, inventoryItem.upc || null, createdAt,
          inventoryItem.id, member.id, maxRedemptions, createdAt, member.id
        ).run()
        : await env.DB.prepare(`
          INSERT OR IGNORE INTO offer_campaigns(
            id,owner_member_id,title,reward_type,reward_variant,percent,max_redemptions,pack_count,offer_token,expires_at,never_expires,
            inventory_item_id,product_name_snapshot,product_upc_snapshot,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          campaignId, member.id, title, storageRewardType, rewardVariant, percent, maxRedemptions, packCount, offerToken, expiresAt, neverExpires ? 1 : 0,
          null, null, null, createdAt
        ).run();
      if (Number(inserted.meta?.changes || 0) === 1) campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE id=?`).bind(campaignId).first();
    }
    if (!campaign) return response({ error: inventoryItem ? "Inventory capacity changed while the campaign was being created. Refresh inventory and try again." : "The campaign could not be created. Try again." }, inventoryItem ? 409 : 503, cors);
    await audit(env, request, "campaign_created", member.id, `${campaign.id}|${rewardType}|max:${maxRedemptions}${inventoryItem ? `|inventory:${inventoryItem.id}` : ""}`);
    return response({ serverNow: createdAt, campaign: adminCampaignView(campaign, [], env, epochMs) }, 201, cors);
  }
  if (url.pathname === "/admin/campaigns" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const [campaignRows, redemptionRows] = await Promise.all([
      env.DB.prepare(`SELECT * FROM offer_campaigns WHERE owner_member_id=? ORDER BY created_at DESC`).bind(member.id).all(),
      env.DB.prepare(`
        SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot,m.email,m.live_username
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
  if (url.pathname === "/admin/giveaways" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const [sellerRows, giftedRows] = await Promise.all([
      env.DB.prepare(`SELECT * FROM seller_giveaways WHERE owner_member_id=? ORDER BY updated_at DESC`).bind(member.id).all(),
      env.DB.prepare(`SELECT * FROM gifted_giveaways WHERE owner_member_id=? ORDER BY updated_at DESC`).bind(member.id).all()
    ]);
    return response({
      sellerGiveaways: (sellerRows.results || []).map(row => ({
        id: row.id, showId: row.show_id || "", title: row.title, quantity: Number(row.quantity || 0),
        inventoryLabel: row.inventory_label, eligibilityProfile: row.eligibility_profile || "", openMode: row.open_mode || "",
        rules: row.rules || "", status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
      })),
      giftedGiveaways: (giftedRows.results || []).map(row => ({
        id: row.id, showId: row.show_id || "", title: row.title, productName: row.product_name, quantity: Number(row.quantity || 0),
        status: row.status, reservedUnits: Number(row.reserved_units || 0), paymentReference: row.payment_reference || "",
        message: row.message || "", createdAt: row.created_at, updatedAt: row.updated_at
      }))
    }, 200, cors);
  }
  if (url.pathname === "/admin/giveaways" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    const title = clean(data?.title, 100);
    const inventoryLabel = clean(data?.inventoryLabel, 100);
    const quantity = Number.parseInt(data?.quantity, 10);
    if (!title) return response({ error: "Enter a giveaway title." }, 400, cors);
    if (!inventoryLabel) return response({ error: "Enter an inventory label." }, 400, cors);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return response({ error: "Winner count must be from 1 to 50." }, 400, cors);
    const giveaway = {
      id: id(),
      owner_member_id: member.id,
      show_id: clean(data?.showId, 80),
      title,
      quantity,
      inventory_label: inventoryLabel,
      eligibility_profile: clean(data?.eligibilityProfile, 100),
      open_mode: clean(data?.openMode, 100),
      rules: clean(data?.rules, 500),
      status: "draft",
      created_at: now(),
      updated_at: now()
    };
    await env.DB.prepare(`
      INSERT INTO seller_giveaways(id,owner_member_id,show_id,title,quantity,inventory_label,eligibility_profile,open_mode,rules,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(giveaway.id, giveaway.owner_member_id, giveaway.show_id, giveaway.title, giveaway.quantity, giveaway.inventory_label, giveaway.eligibility_profile, giveaway.open_mode, giveaway.rules, giveaway.status, giveaway.created_at, giveaway.updated_at).run();
    await audit(env, request, "seller_giveaway_created", member.id, giveaway.id);
    return response({ giveaway }, 201, cors);
  }
  if (url.pathname === "/admin/gifted-giveaways" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    const title = clean(data?.title, 100);
    const productName = clean(data?.productName, 120);
    const quantity = Number.parseInt(data?.quantity, 10);
    if (!title) return response({ error: "Enter a gifted giveaway title." }, 400, cors);
    if (!productName) return response({ error: "Enter a product name." }, 400, cors);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return response({ error: "Quantity must be from 1 to 50." }, 400, cors);
    const inventoryItemId = String(data?.inventoryItemId || "");
    if (inventoryItemId && !/^[0-9a-f-]{36}$/i.test(inventoryItemId)) return response({ error: "Choose a valid inventory item." }, 400, cors);
    if (inventoryItemId) {
      const inventoryItem = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id=? AND owner_member_id=? AND is_active=1`).bind(inventoryItemId, member.id).first();
      if (!inventoryItem || Number(inventoryItem.quantity || 0) < quantity) return response({ error: "That inventory item is not available in the requested quantity." }, 409, cors);
    }
    const gifted = {
      id: id(),
      owner_member_id: member.id,
      giver_member_id: data?.giverMemberId && /^[0-9a-f-]{36}$/i.test(String(data.giverMemberId)) ? String(data.giverMemberId) : null,
      show_id: clean(data?.showId, 80),
      title,
      product_name: productName,
      quantity,
      status: inventoryItemId ? "reserved" : "pending_payment",
      inventory_item_id: inventoryItemId || null,
      reserved_units: inventoryItemId ? quantity : 0,
      payment_reference: clean(data?.paymentReference, 120),
      message: clean(data?.message, 500),
      created_at: now(),
      updated_at: now()
    };
    if (inventoryItemId) {
      const available = await env.DB.prepare(`SELECT quantity FROM inventory_items WHERE id=? AND owner_member_id=? AND is_active=1`).bind(inventoryItemId, member.id).first();
      if (!available || Number(available.quantity || 0) < quantity) return response({ error: "That inventory item is no longer available." }, 409, cors);
      await env.DB.prepare(`UPDATE inventory_items SET quantity=quantity-? , updated_at=? WHERE id=? AND owner_member_id=? AND quantity>=?`).bind(quantity, gifted.created_at, inventoryItemId, member.id, quantity).run();
    }
    await env.DB.prepare(`
      INSERT INTO gifted_giveaways(id,owner_member_id,giver_member_id,show_id,title,product_name,quantity,status,inventory_item_id,reserved_units,payment_reference,message,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(gifted.id, gifted.owner_member_id, gifted.giver_member_id, gifted.show_id, gifted.title, gifted.product_name, gifted.quantity, gifted.status, gifted.inventory_item_id, gifted.reserved_units, gifted.payment_reference, gifted.message, gifted.created_at, gifted.updated_at).run();
    await audit(env, request, "gifted_giveaway_created", member.id, gifted.id);
    return response({ gifted }, 201, cors);
  }
  const adminCampaignQrMatch = url.pathname.match(/^\/admin\/campaigns\/([0-9a-f-]{36})\/qr$/i);
  if (adminCampaignQrMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE id=? AND owner_member_id=?`).bind(adminCampaignQrMatch[1], member.id).first();
    if (!campaign) return response({ error: "Campaign not found." }, 404, cors);
    if (!campaignIsActive(campaign)) return response({ error: "This campaign QR is turned off. Turn it on before downloading or sharing it." }, 410, cors);
    await audit(env, request, "campaign_qr_generated", member.id, campaign.id);
    return svgResponse(await referralQrSvg(campaignUrl(campaign, env)), cors);
  }
  const adminCampaignStatusMatch = url.pathname.match(/^\/admin\/campaigns\/([0-9a-f-]{36})\/status$/i);
  if (adminCampaignStatusMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const data = await body(request);
    if (typeof data?.active !== "boolean") return response({ error: "Choose whether this campaign QR is active." }, 400, cors);
    let updated;
    try {
      updated = await env.DB.prepare(`UPDATE offer_campaigns SET is_active=? WHERE id=? AND owner_member_id=?`).bind(data.active ? 1 : 0, adminCampaignStatusMatch[1], member.id).run();
    } catch (error) {
      if (/INVENTORY_COMMITMENT_CONFLICT/i.test(String(error?.message || ""))) return response({ error: "This product campaign cannot be turned back on because its inventory is inactive or the units are now reserved elsewhere." }, 409, cors);
      throw error;
    }
    if (Number(updated.meta?.changes || 0) !== 1) return response({ error: "Campaign not found." }, 404, cors);
    const campaign = await env.DB.prepare(`SELECT * FROM offer_campaigns WHERE id=? AND owner_member_id=?`).bind(adminCampaignStatusMatch[1], member.id).first();
    const redemptions = await env.DB.prepare(`
      SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot,m.email,m.live_username
      FROM campaign_redemptions cr JOIN offer_campaigns c ON c.id=cr.campaign_id JOIN members m ON m.id=cr.member_id
      WHERE cr.campaign_id=? ORDER BY cr.claim_rank
    `).bind(campaign.id).all();
    await audit(env, request, data.active ? "campaign_qr_enabled" : "campaign_qr_disabled", member.id, campaign.id);
    return response({ campaign: adminCampaignView(campaign, redemptions.results || [], env, Date.now()) }, 200, cors);
  }
  const adminCampaignRedeemMatch = url.pathname.match(/^\/admin\/campaign-redemptions\/([0-9a-f-]{36})\/redeem$/i);
  if (adminCampaignRedeemMatch && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const redemption = await env.DB.prepare(`
      SELECT cr.*,c.title,c.reward_type,c.reward_variant,c.percent,c.max_redemptions,c.pack_count,c.expires_at,c.never_expires,c.inventory_item_id,c.product_name_snapshot,c.product_upc_snapshot,m.email,m.live_username
      FROM campaign_redemptions cr
      JOIN offer_campaigns c ON c.id=cr.campaign_id
      JOIN members m ON m.id=cr.member_id
      WHERE cr.id=? AND c.owner_member_id=?
    `).bind(adminCampaignRedeemMatch[1], member.id).first();
    if (!redemption) return response({ error: "Campaign redemption not found." }, 404, cors);
    if (redemption.redeemed_at) return response({ error: "This campaign reward was already marked redeemed." }, 409, cors);
    if (!campaignNeverExpires(redemption) && redemption.expires_at <= now()) return response({ error: "This campaign reward has expired and cannot be redeemed." }, 410, cors);
    const redeemedAt = now();
    let updated;
    try {
      updated = await env.DB.prepare(`UPDATE campaign_redemptions SET redeemed_at=?,redeemed_by_member_id=? WHERE id=? AND redeemed_at IS NULL`).bind(redeemedAt, member.id, redemption.id).run();
    } catch (error) {
      if (/PRODUCT_STOCK_UNAVAILABLE|INVENTORY_COMMITMENT_CONFLICT/i.test(String(error?.message || ""))) return response({ error: "This product reward cannot be fulfilled because its inventory quantity is no longer available. Correct inventory before marking it redeemed." }, 409, cors);
      throw error;
    }
    if (Number(updated.meta?.changes || 0) !== 1) return response({ error: "This campaign reward was already marked redeemed." }, 409, cors);
    redemption.redeemed_at = redeemedAt;
    await audit(env, request, "campaign_redemption_redeemed", member.id, `${redemption.id}|member:${redemption.member_id}|code:${redemption.code}`);
    return response({ redemption: adminRedemptionView(redemption) }, 200, cors);
  }
  if (url.pathname === "/admin/members" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const query = clean(url.searchParams.get("q"), 80).toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9@._+ -]/g, "");
    const includeOwner = url.searchParams.get("excludeOwner") !== "1";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? `${url.searchParams.get("from")}T00:00:00.000Z` : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? `${url.searchParams.get("to")}T23:59:59.999Z` : "";
    const search = `%${query}%`;
    const rows = await env.DB.prepare(`
      SELECT id,email,first_name,last_name,live_username,created_at,referral_qualified_at
      FROM members
      WHERE email_verified_at IS NOT NULL AND identity_status='verified' AND (?=1 OR email<>?)
        AND (?='' OR created_at>=?) AND (?='' OR created_at<=?)
        AND (?='' OR lower(email) LIKE ? OR lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? OR lower(COALESCE(live_username,'')) LIKE ?)
      ORDER BY created_at DESC LIMIT 250
    `).bind(includeOwner ? 1 : 0, normalizeEmail(env.ADMIN_EMAIL), from, from, to, to, query, search, search, search).all();
    return response({ members: (rows.results || []).map(row => ({ id: row.id, email: row.email, firstName: row.first_name || "", lastName: row.last_name || "", liveUsername: row.live_username || "", createdAt: row.created_at, qualifiedAt: row.referral_qualified_at || null, isOwner: normalizeEmail(row.email) === normalizeEmail(env.ADMIN_EMAIL) })) }, 200, cors);
  }
  if (url.pathname === "/admin/orders" && request.method === "GET") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const query = clean(url.searchParams.get("q"), 100).toLowerCase().replace(/[^a-z0-9@._+ -]/g, "");
    const search = `%${query}%`;
    const rows = await env.DB.prepare(`
      SELECT orders.*,shipments.easypost_tracker_id,shipments.mode tracking_mode,shipments.carrier,shipments.tracking_code,
             shipments.status tracking_status,shipments.status_detail,shipments.estimated_delivery_date,
             shipments.carrier_public_url,shipments.tracking_details_json,
             customer.email,customer.first_name,customer.last_name,customer.live_username
      FROM member_orders orders
      LEFT JOIN order_shipments shipments ON shipments.order_id=orders.id
      JOIN members customer ON customer.id=orders.member_id
      WHERE orders.owner_member_id=? AND (?='' OR lower(orders.order_number) LIKE ? OR lower(customer.email) LIKE ?
        OR lower(COALESCE(customer.first_name,'') || ' ' || COALESCE(customer.last_name,'')) LIKE ?
        OR lower(COALESCE(customer.live_username,'')) LIKE ? OR lower(COALESCE(shipments.tracking_code,'')) LIKE ?)
      ORDER BY orders.updated_at DESC LIMIT 200
    `).bind(member.id, query, search, search, search, search, search).all();
    return response({ orders: (rows.results || []).map(row => ({
      ...orderView(row, env),
      member: { id: row.member_id, email: row.email, firstName: row.first_name || "", lastName: row.last_name || "", liveUsername: row.live_username || "" }
    })) }, 200, cors);
  }
  if (url.pathname === "/admin/orders" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 20_000) return response({ error: "Order request is too large." }, 413, cors);
    const data = await body(request);
    const memberId = String(data?.memberId || "");
    const orderNumber = clean(data?.orderNumber, 64);
    const channel = ["website", "manual"].includes(data?.channel) ? data.channel : "manual";
    const items = parseOrderItems(data?.items);
    const trackingCode = clean(data?.trackingCode, 120).replace(/\s+/g, "");
    const carrier = clean(data?.carrier, 60).replace(/[^a-z0-9]/gi, "");
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return response({ error: "Choose a verified member from search results." }, 400, cors);
    if (!orderNumber || !/^[a-z0-9._-]+$/i.test(orderNumber)) return response({ error: "Order number can use letters, numbers, dots, dashes, and underscores." }, 400, cors);
    if (!items) return response({ error: "Add 1 to 50 purchased items with valid quantities." }, 400, cors);
    if (!/^[a-z0-9-]{5,120}$/i.test(trackingCode)) return response({ error: "Enter a valid carrier tracking number." }, 400, cors);
    const customer = await env.DB.prepare(`SELECT id FROM members WHERE id=? AND email_verified_at IS NOT NULL AND identity_status='verified'`).bind(memberId).first();
    if (!customer) return response({ error: "That verified member was not found." }, 404, cors);
    const duplicate = await env.DB.prepare(`SELECT id FROM member_orders WHERE order_number=?`).bind(orderNumber).first();
    if (duplicate) return response({ error: "That order number is already in the dashboard." }, 409, cors);
    let tracker;
    try { tracker = await easyPostCreateTracker(env, trackingCode, carrier); }
    catch (error) {
      if (error.message === "TRACKING_NOT_CONFIGURED") return response({ error: "Add the EasyPost test or production API key before creating tracking." }, 503, cors);
      return response({ error: "EasyPost could not create that tracker. Check the carrier and tracking number." }, 502, cors);
    }
    const trackerDuplicate = await env.DB.prepare(`SELECT order_id FROM order_shipments WHERE easypost_tracker_id=?`).bind(tracker.id).first();
    if (trackerDuplicate) return response({ error: "That carrier tracking number is already attached to an order." }, 409, cors);
    const createdAt = now();
    const orderId = id();
    const initialOrderStatus = tracker.status === "delivered" ? "delivered" : ["pre_transit", "unknown", "error"].includes(tracker.status) ? "processing" : "shipped";
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO member_orders(id,member_id,owner_member_id,order_number,channel,items_json,status,placed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(orderId, memberId, member.id, orderNumber, channel, JSON.stringify(items), initialOrderStatus, createdAt, createdAt, createdAt),
        env.DB.prepare(`INSERT INTO order_shipments(id,order_id,easypost_tracker_id,mode,carrier,tracking_code,status,status_detail,estimated_delivery_date,carrier_public_url,tracking_details_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id(), orderId, tracker.id, tracker.mode, tracker.carrier, tracker.trackingCode, tracker.status, tracker.statusDetail, tracker.estimatedDeliveryDate, tracker.publicUrl, JSON.stringify(tracker.details), createdAt, createdAt)
      ]);
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return response({ error: "That order or tracking number is already attached." }, 409, cors);
      throw error;
    }
    await audit(env, request, "member_order_tracking_created", member.id, `${orderId}|member:${memberId}|tracker:${tracker.id}|mode:${tracker.mode}`);
    const saved = await env.DB.prepare(`${orderSelectSql} WHERE orders.id=? LIMIT 1`).bind(orderId).first();
    return response({ order: orderView(saved, env) }, 201, cors);
  }
  if (url.pathname === "/admin/email" && request.method === "POST") {
    if (!await hasFreshAdminSession(request, member, env)) return response({ error: "Fresh owner passkey verification required." }, 403, cors);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 20000) return response({ error: "Email request is too large." }, 413, cors);
    const data = await body(request);
    const allowedSenders = new Set(["rewards@crackpacks.com", "alerts@crackpacks.com", "orders@crackpacks.com", "support@crackpacks.com", "hello@crackpacks.com"]);
    const senderAddress = normalizeEmail(data?.fromAddress || "rewards@crackpacks.com");
    if (!allowedSenders.has(senderAddress)) return response({ error: "Choose an approved Crack Packs sender address." }, 400, cors);
    const audience = ["all", "selected", "tier"].includes(data?.audience) ? data.audience : "";
    const rawSubject = boundedString(data?.subject, 120);
    const rawMessage = boundedString(data?.message, 5000);
    const subject = rawSubject === null ? "" : clean(rawSubject, 120);
    const message = rawMessage === null ? "" : String(rawMessage).trim();
    if (!audience) return response({ error: "Choose Message All or Select Few." }, 400, cors);
    if (!subject || subject.length < 3) return response({ error: "Enter an email subject from 3 to 120 characters." }, 400, cors);
    if (!message || message.length < 3) return response({ error: "Enter an email message from 3 to 5,000 characters." }, 400, cors);
    let rows;
    if (audience === "all") {
      rows = await env.DB.prepare(`SELECT id,email,first_name,live_username FROM members WHERE email_verified_at IS NOT NULL AND identity_status='verified' AND email<>? ORDER BY created_at LIMIT 101`).bind(normalizeEmail(env.ADMIN_EMAIL)).all();
    } else if (audience === "tier") {
      const ranges = { crew: [3, 10], breaker: [10, 25], headliner: [25, 50], legend: [50, 1000000] };
      const range = ranges[String(data?.tierName || "").toLowerCase()];
      if (!range) return response({ error: "Choose Crew, Breaker, Headliner, or Legend." }, 400, cors);
      rows = await env.DB.prepare(`
        SELECT member.id,member.email,member.first_name,member.live_username,COUNT(referral.id) referral_count
        FROM members member LEFT JOIN members referral ON referral.referred_by_member_id=member.id AND referral.referral_qualified_at IS NOT NULL AND referral.identity_status='verified'
        WHERE member.email_verified_at IS NOT NULL AND member.identity_status='verified' AND member.email<>?
        GROUP BY member.id HAVING referral_count>=? AND referral_count<? ORDER BY member.created_at LIMIT 101
      `).bind(normalizeEmail(env.ADMIN_EMAIL), range[0], range[1]).all();
    } else {
      const memberIds = Array.isArray(data?.memberIds) ? [...new Set(data.memberIds.filter(value => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 101) : [];
      if (!memberIds.length) return response({ error: "Add at least one member before sending." }, 400, cors);
      const placeholders = memberIds.map(() => "?").join(",");
      rows = await env.DB.prepare(`SELECT id,email,first_name,live_username FROM members WHERE id IN (${placeholders}) AND email_verified_at IS NOT NULL AND identity_status='verified' AND email<>?`).bind(...memberIds, normalizeEmail(env.ADMIN_EMAIL)).all();
    }
    const recipients = rows.results || [];
    if (!recipients.length) return response({ error: "No verified member recipients matched this message." }, 400, cors);
    if (recipients.length > 100) return response({ error: "Message All currently supports up to 100 verified members per send. Use Select Few for a smaller group." }, 400, cors);
    const sendId = id();
    try {
      await sendMemberEmailBatch(env, recipients, subject, message, sendId, senderAddress);
    } catch (error) {
      if (error.message === "MEMBER_EMAIL_NOT_CONFIGURED") return response({ error: "Member email is not configured. Add the existing RESEND_API_KEY Worker secret." }, 503, cors);
      return response({ error: "The member email batch could not be queued. No send was confirmed; try again." }, 502, cors);
    }
    await audit(env, request, "member_email_sent", member.id, `${sendId}|from:${senderAddress}|audience:${audience}|count:${recipients.length}|subject:${subject.slice(0, 80)}`);
    return response({ ok: true, sendId, senderAddress, recipientCount: recipients.length }, 202, cors);
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
             m.id member_id,m.email,m.first_name,m.last_name,m.live_username
      FROM discount_claims dc JOIN members m ON m.id=dc.member_id
      WHERE (?='' OR lower(dc.code) LIKE ? OR lower(m.email) LIKE ? OR lower(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,'')) LIKE ? OR lower(COALESCE(m.live_username,'')) LIKE ?)
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
        `Crack Packs discount requested: ${claim.code}`,
        `<h1>Crack Packs discount requested</h1><p><strong>Code:</strong> ${escapeHtml(claim.code)}</p><p><strong>Discount:</strong> ${Number(claim.percent)}%</p><p><strong>Member:</strong> ${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</p><p><strong>Member email:</strong> ${escapeHtml(member.email)}</p><p><strong>User ID:</strong> ${escapeHtml(member.live_username || "Not provided")}</p><p><strong>Requested:</strong> ${escapeHtml(requestedAt)}</p><p>After the buyer uses this code in an eligible Crack Packs sale, open the owner dashboard and mark it Redeemed.</p>`,
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
export default {
  async fetch(request, env, ctx) {
    const cors = corsFor(request, env); if (!cors) return response({ error: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try { return await route(request, env, cors, ctx); } catch (error) { console.error(error); return response({ error: error.message === "INVALID_JSON" ? "Invalid request body." : "The rewards service encountered an error." }, 500, cors); }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runStreamCreditCycle(env, { notify: true }).catch(error => console.error("Scheduled stream credit cycle failed", error)));
  }
};
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
