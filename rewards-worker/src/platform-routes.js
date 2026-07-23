import { stripeGet, stripeRequest, verifyStripeWebhook } from "./stripe-commerce.js";

const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const normalizeEmail = value => String(value || "").trim().toLowerCase().slice(0, 254);
const clean = (value, max = 120) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const json = (body, status = 200, cors = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }
});
const boundedJson = async (request, maxBytes = 12000) => {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("INVALID_JSON"); }
};
async function digest(value, secret = "") {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:${value}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function memberFromRequest(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  return env.DB.prepare(`SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await digest(token, env.AUTH_SECRET), now()).first();
}
async function sellerProfile(env, memberId) {
  return env.DB.prepare(`SELECT * FROM breaker_profiles WHERE member_id=?`).bind(memberId).first();
}
async function requireMember(request, env, cors, { verified = true, seller = false } = {}) {
  const member = await memberFromRequest(request, env);
  if (!member) return { error: json({ error: "Sign in to continue." }, 401, cors) };
  if (verified && (!member.email_verified_at || !member.device_verified || member.identity_status !== "verified")) {
    return { error: json({ error: "Complete email, passkey, and identity verification first." }, 403, cors) };
  }
  const profile = seller ? await sellerProfile(env, member.id) : null;
  if (seller && profile?.status !== "active" && normalizeEmail(member.email) !== normalizeEmail(env.ADMIN_EMAIL)) return { error: json({ error: "Active Seller Portal access is required." }, 403, cors) };
  return { member, profile };
}
async function requireOwner(request, env, cors) {
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth;
  if (normalizeEmail(auth.member.email) !== normalizeEmail(env.ADMIN_EMAIL)) return { error: json({ error: "Owner access required." }, 403, cors) };
  const adminToken = request.headers.get("X-Admin-Token") || "";
  const fresh = adminToken && await env.DB.prepare(`SELECT member_id FROM admin_sessions WHERE token_hash=? AND member_id=? AND expires_at>?`)
    .bind(await digest(adminToken, env.AUTH_SECRET), auth.member.id, now()).first();
  return fresh ? auth : { error: json({ error: "Fresh owner passkey verification required." }, 403, cors) };
}
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const randomToken = (length = 40) => Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[byte % 57]).join("");
const orderNumber = () => `CP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const siteUrl = env => String(env.SITE_URL || "https://crackpacks.com").replace(/\/$/, "");

async function sendOrderEmail(env, to, subject, html, key) {
  if (!env.RESEND_API_KEY || !to) return;
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ from: "Crack Packs Orders <orders@crackpacks.com>", to: [to], subject, html })
  });
  if (!result.ok) console.error("Order email failed", { status: result.status });
}

function usernameKey(value) {
  const folded = String(value || "").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[@4]/g, "a").replace(/[3]/g, "e").replace(/[1!|]/g, "i").replace(/[0]/g, "o")
    .replace(/[5$]/g, "s").replace(/[7+]/g, "t").replace(/[^a-z0-9]/g, "");
  return folded.replace(/(.)\1{2,}/g, "$1$1");
}

async function reserveOwnerInventory(env, itemId, ownerId, quantity, reservationId, note) {
  const stamp = now();
  let changed;
  try {
    changed = await env.DB.prepare(`UPDATE inventory_items SET quantity=quantity-?,updated_at=? WHERE id=? AND owner_member_id=? AND is_active=1 AND quantity>=?`)
      .bind(quantity, stamp, itemId, ownerId, quantity).run();
  } catch (error) {
    if (/INVENTORY_COMMITMENT_CONFLICT|PRODUCT_STOCK_UNAVAILABLE/i.test(String(error?.message || ""))) return false;
    throw error;
  }
  if (Number(changed.meta?.changes || 0) !== 1) return false;
  const row = await env.DB.prepare(`SELECT quantity FROM inventory_items WHERE id=?`).bind(itemId).first();
  await env.DB.prepare(`INSERT INTO inventory_stock_movements(id,inventory_item_id,owner_member_id,reservation_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(uid(), itemId, ownerId, reservationId, "reserved", -quantity, Number(row?.quantity || 0), clean(note, 300), stamp).run();
  return true;
}

async function releaseOwnerInventory(env, reservation, movementType = "released") {
  if (!reservation?.inventory_item_id || !reservation?.quantity) return;
  const stamp = now();
  await env.DB.prepare(`UPDATE inventory_items SET quantity=quantity+?,updated_at=? WHERE id=? AND owner_member_id=?`)
    .bind(Number(reservation.quantity), stamp, reservation.inventory_item_id, reservation.owner_member_id).run();
  const row = await env.DB.prepare(`SELECT quantity FROM inventory_items WHERE id=?`).bind(reservation.inventory_item_id).first();
  await env.DB.prepare(`INSERT INTO inventory_stock_movements(id,inventory_item_id,owner_member_id,reservation_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(uid(), reservation.inventory_item_id, reservation.owner_member_id, reservation.id, movementType, Number(reservation.quantity), Number(row?.quantity || 0), "Checkout inventory returned", stamp).run();
}

async function createStoreCheckout(request, env, cors) {
  if (String(env.STORE_COMING_SOON || "true") !== "false" || String(env.STORE_CHECKOUT_ENABLED || "false") !== "true") {
    return json({ error: "Checkout is locked until the owner enables the production store." }, 503, cors);
  }
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const data = await boundedJson(request);
  const quoteId = String(data.quoteId || "");
  const rateId = String(data.rateId || "");
  if (!validUuid(quoteId) || !/^rate_[A-Za-z0-9]+$/.test(rateId)) return json({ error: "Choose a current shipping quote and carrier rate." }, 400, cors);
  const quote = await env.DB.prepare(`
    SELECT q.*,i.name,i.public_slug,i.owner_member_id,i.website_list_price_cents,i.international_list_price_cents,
           i.cogs_cents,i.us_shipping_cents,i.packaging_cents,i.overhead_cents
    FROM shipping_quotes q JOIN inventory_items i ON i.id=q.inventory_item_id
    WHERE q.id=? AND q.expires_at>? AND i.is_active=1 AND i.is_store_visible=1
  `).bind(quoteId, now()).first();
  if (!quote) return json({ error: "That shipping quote expired. Request a new quote." }, 410, cors);
  let rates = [];
  try { rates = JSON.parse(quote.rates_json || "[]"); } catch {}
  const rate = rates.find(entry => entry.id === rateId);
  if (!rate) return json({ error: "That carrier rate is no longer in this quote." }, 400, cors);
  const market = quote.market === "international" ? "international" : "us";
  const configuredPrice = market === "us" ? quote.website_list_price_cents : quote.international_list_price_cents;
  const fallback = Number(quote.cogs_cents || 0) + Number(quote.us_shipping_cents || 0) + Number(quote.packaging_cents || 0) + Number(quote.overhead_cents || 0) + 1000;
  const unitAmount = Number(configuredPrice ?? fallback);
  if (!Number.isInteger(unitAmount) || unitAmount < 50) return json({ error: "This product needs a valid website price before checkout." }, 409, cors);
  let address = {};
  try { address = JSON.parse(quote.address_json || "{}"); } catch {}
  if (!address.email) address.email = auth.member.email;
  const reservationId = uid();
  const expiresAt = new Date(Date.now() + 30 * 60e3).toISOString();
  const reserved = await reserveOwnerInventory(env, quote.inventory_item_id, quote.owner_member_id, Number(quote.quantity), reservationId, `Store checkout ${quoteId}`);
  if (!reserved) return json({ error: "This item sold out while checkout was opening." }, 409, cors);
  await env.DB.prepare(`
    INSERT INTO checkout_reservations(id,member_id,owner_member_id,inventory_item_id,shipping_quote_id,quantity,product_name,unit_amount_cents,shipping_amount_cents,currency,easypost_shipment_id,easypost_rate_id,carrier,service,address_json,status,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(reservationId, auth.member.id, quote.owner_member_id, quote.inventory_item_id, quote.id, Number(quote.quantity), quote.name, unitAmount, Number(rate.amountCents), "USD", quote.easypost_shipment_id, rate.id, clean(rate.carrier, 60), clean(rate.service, 80), JSON.stringify(address), "creating", expiresAt, now(), now()).run();
  let session;
  try {
    session = await stripeRequest(env.STRIPE_SECRET_KEY, "/checkout/sessions", [
      ["mode", "payment"], ["customer_email", auth.member.email], ["success_url", `${siteUrl(env)}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`],
      ["cancel_url", `${siteUrl(env)}/shop.html?checkout=cancelled`], ["expires_at", Math.floor(Date.parse(expiresAt) / 1000)],
      ["line_items[0][price_data][currency]", "usd"], ["line_items[0][price_data][unit_amount]", unitAmount],
      ["line_items[0][price_data][product_data][name]", quote.name], ["line_items[0][quantity]", Number(quote.quantity)],
      ["line_items[1][price_data][currency]", "usd"], ["line_items[1][price_data][unit_amount]", Number(rate.amountCents)],
      ["line_items[1][price_data][product_data][name]", `${clean(rate.carrier, 60)} ${clean(rate.service, 80)} shipping`], ["line_items[1][quantity]", 1],
      ["metadata[kind]", "store_order"], ["metadata[reservation_id]", reservationId], ["metadata[member_id]", auth.member.id]
    ], `store-checkout-${reservationId}`);
  } catch (error) {
    const reservation = await env.DB.prepare(`SELECT * FROM checkout_reservations WHERE id=?`).bind(reservationId).first();
    await releaseOwnerInventory(env, reservation);
    await env.DB.prepare(`UPDATE checkout_reservations SET status='failed',updated_at=? WHERE id=?`).bind(now(), reservationId).run();
    return json({ error: error.message === "STRIPE_NOT_CONFIGURED" ? "Stripe production checkout is not configured." : "Stripe could not open checkout." }, 503, cors);
  }
  await env.DB.prepare(`UPDATE checkout_reservations SET status='open',stripe_checkout_session_id=?,expires_at=?,updated_at=? WHERE id=?`)
    .bind(session.id, new Date(Number(session.expires_at) * 1000).toISOString(), now(), reservationId).run();
  return json({ checkoutUrl: session.url, sessionId: session.id, expiresAt: new Date(Number(session.expires_at) * 1000).toISOString() }, 201, cors);
}

async function createGiftCheckout(request, env, cors) {
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth.error;
  const data = await boundedJson(request);
  const showId = String(data.showId || "");
  const breakerInventoryId = String(data.inventoryItemId || "");
  const quantity = Number(data.quantity || 1);
  if (!validUuid(showId) || !validUuid(breakerInventoryId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return json({ error: "Choose a live show product and valid giveaway quantity." }, 400, cors);
  }
  const item = await env.DB.prepare(`
    SELECT bi.*,s.member_id seller_member_id,s.title show_title,source.website_list_price_cents,source.live_list_price_cents,
           source.name source_name
    FROM breaker_inventory_items bi
    JOIN breaker_stream_sessions s ON s.member_id=bi.member_id AND s.id=?
    LEFT JOIN inventory_items source ON source.id=bi.source_inventory_item_id
    WHERE bi.id=? AND bi.quantity>=? AND s.status IN ('open','live')
  `).bind(showId, breakerInventoryId, quantity).first();
  if (!item) return json({ error: "That seller product is no longer available for this show." }, 409, cors);
  const unitAmount = Number(item.live_list_price_cents ?? item.website_list_price_cents ?? 0);
  if (!Number.isInteger(unitAmount) || unitAmount < 50) return json({ error: "The seller has not configured a gift price for this product." }, 409, cors);
  const giftId = uid();
  const stamp = now();
  const expiresAt = new Date(Date.now() + 30 * 60e3).toISOString();
  const held = await env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=quantity-?,updated_at=? WHERE id=? AND member_id=? AND quantity>=?`)
    .bind(quantity, stamp, item.id, item.seller_member_id, quantity).run();
  if (Number(held.meta?.changes || 0) !== 1) return json({ error: "That giveaway item was just reserved by someone else." }, 409, cors);
  const after = await env.DB.prepare(`SELECT quantity FROM breaker_inventory_items WHERE id=?`).bind(item.id).first();
  await env.DB.prepare(`INSERT INTO breaker_inventory_movements(id,breaker_inventory_item_id,member_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(uid(), item.id, item.seller_member_id, "order_pending", -quantity, Number(after?.quantity || 0), `Gifted giveaway hold ${giftId}`, stamp).run();
  const title = clean(data.title || `${item.product_name} giveaway`, 100);
  await env.DB.prepare(`
    INSERT INTO gifted_giveaways(id,owner_member_id,giver_member_id,show_id,title,product_name,quantity,status,inventory_item_id,breaker_inventory_item_id,reserved_units,payment_reference,message,created_at,updated_at,unit_amount_cents,currency,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(giftId, item.seller_member_id, auth.member.id, showId, title, item.product_name, quantity, "pending_payment", null, item.id, quantity, "", clean(data.message, 500), stamp, stamp, unitAmount, "USD", expiresAt).run();
  let session;
  try {
    session = await stripeRequest(env.STRIPE_SECRET_KEY, "/checkout/sessions", [
      ["mode", "payment"], ["customer_email", auth.member.email], ["success_url", `${siteUrl(env)}/streams.html?gift=success`],
      ["cancel_url", `${siteUrl(env)}/streams.html?gift=cancelled`], ["expires_at", Math.floor(Date.parse(expiresAt) / 1000)],
      ["line_items[0][price_data][currency]", "usd"], ["line_items[0][price_data][unit_amount]", unitAmount],
      ["line_items[0][price_data][product_data][name]", `Gifted giveaway: ${item.product_name}`], ["line_items[0][quantity]", quantity],
      ["metadata[kind]", "gifted_giveaway"], ["metadata[gift_id]", giftId], ["metadata[member_id]", auth.member.id]
    ], `gift-checkout-${giftId}`);
  } catch (error) {
    await env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=quantity+?,updated_at=? WHERE id=?`).bind(quantity, now(), item.id).run();
    await env.DB.prepare(`UPDATE gifted_giveaways SET status='cancelled',reserved_units=0,updated_at=? WHERE id=?`).bind(now(), giftId).run();
    return json({ error: error.message === "STRIPE_NOT_CONFIGURED" ? "Stripe gifting checkout is not configured." : "Stripe could not open gifting checkout." }, 503, cors);
  }
  await env.DB.prepare(`UPDATE gifted_giveaways SET stripe_checkout_session_id=?,payment_reference=?,expires_at=?,updated_at=? WHERE id=?`)
    .bind(session.id, session.id, new Date(Number(session.expires_at) * 1000).toISOString(), now(), giftId).run();
  return json({ checkoutUrl: session.url, giftId, expiresAt: new Date(Number(session.expires_at) * 1000).toISOString() }, 201, cors);
}

async function completeStoreOrder(env, session) {
  const reservationId = String(session.metadata?.reservation_id || "");
  if (!validUuid(reservationId)) return;
  const reservation = await env.DB.prepare(`SELECT r.*,m.email FROM checkout_reservations r JOIN members m ON m.id=r.member_id WHERE r.id=?`).bind(reservationId).first();
  if (!reservation || reservation.status === "paid") return;
  if (!['open','creating'].includes(reservation.status)) return;
  const orderId = uid();
  const stamp = now();
  const number = orderNumber();
  const items = JSON.stringify([{ inventoryItemId: reservation.inventory_item_id, name: reservation.product_name, quantity: Number(reservation.quantity), unitAmountCents: Number(reservation.unit_amount_cents) }]);
  const statements = [
    env.DB.prepare(`INSERT OR IGNORE INTO member_orders(id,member_id,owner_member_id,order_number,channel,items_json,status,placed_at,created_at,updated_at,subtotal_cents,shipping_cents,tax_cents,total_cents,currency,payment_status,stripe_checkout_session_id,stripe_payment_intent_id,shipping_address_json,shipping_service) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(orderId, reservation.member_id, reservation.owner_member_id, number, "website", items, "processing", stamp, stamp, stamp, Number(reservation.unit_amount_cents) * Number(reservation.quantity), Number(reservation.shipping_amount_cents), Number(session.total_details?.amount_tax || 0), Number(session.amount_total || 0), "USD", "paid", session.id, String(session.payment_intent || ""), reservation.address_json, `${reservation.carrier} ${reservation.service}`),
    env.DB.prepare(`UPDATE checkout_reservations SET status='paid',stripe_payment_intent_id=?,order_id=?,updated_at=? WHERE id=? AND status IN ('open','creating')`)
      .bind(String(session.payment_intent || ""), orderId, stamp, reservation.id)
  ];
  const buyerSeller = await sellerProfile(env, reservation.member_id);
  if (buyerSeller?.status === "active") {
    statements.push(env.DB.prepare(`
      INSERT INTO breaker_inventory_items(id,member_id,source_inventory_item_id,product_name,unit_type,quantity,inbound_quantity,created_at,updated_at)
      VALUES(?,?,?,?,'sealed_box',0,?,?,?)
      ON CONFLICT(member_id,source_inventory_item_id,unit_type) DO UPDATE SET inbound_quantity=inbound_quantity+excluded.inbound_quantity,updated_at=excluded.updated_at
    `).bind(uid(), reservation.member_id, reservation.inventory_item_id, reservation.product_name, Number(reservation.quantity), stamp, stamp));
  }
  await env.DB.batch(statements);
  await sendOrderEmail(env, reservation.email, `Order ${number} confirmed`, `<h1>Payment received</h1><p>Your Crack Packs order <strong>${number}</strong> is confirmed.</p><p>${clean(reservation.product_name, 120)} × ${Number(reservation.quantity)}</p><p>Tracking will appear in your Profile after the label is purchased.</p>`, `order-customer-${orderId}`);
  await sendOrderEmail(env, normalizeEmail(env.ORDER_NOTIFY_EMAIL || env.ADMIN_EMAIL), `New paid order ${number}`, `<h1>New paid order</h1><p><strong>${number}</strong></p><p>${clean(reservation.product_name, 120)} × ${Number(reservation.quantity)}</p><p>Open the Master Dashboard to purchase the label.</p>`, `order-owner-${orderId}`);
}

async function completeGift(env, session) {
  const giftId = String(session.metadata?.gift_id || "");
  if (!validUuid(giftId)) return;
  await env.DB.prepare(`UPDATE gifted_giveaways SET status='reserved',stripe_payment_intent_id=?,payment_reference=?,paid_at=?,updated_at=? WHERE id=? AND status='pending_payment'`)
    .bind(String(session.payment_intent || ""), String(session.payment_intent || session.id), now(), now(), giftId).run();
}

async function completeBillingSetup(env, session) {
  const memberId = String(session.metadata?.member_id || "");
  const setupIntentId = String(session.setup_intent || "");
  const customerId = String(session.customer || "");
  if (!validUuid(memberId) || !setupIntentId || !customerId) return;
  const setupIntent = await stripeGet(env.STRIPE_SECRET_KEY, `/setup_intents/${encodeURIComponent(setupIntentId)}`);
  const paymentMethodId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
  if (!paymentMethodId || setupIntent.status !== "succeeded") return;
  const paymentMethod = await stripeGet(env.STRIPE_SECRET_KEY, `/payment_methods/${encodeURIComponent(paymentMethodId)}`);
  await stripeRequest(env.STRIPE_SECRET_KEY, `/customers/${encodeURIComponent(customerId)}`, [
    ["invoice_settings[default_payment_method]", paymentMethodId]
  ], `default-payment-${memberId}-${paymentMethodId}`);
  await env.DB.prepare(`UPDATE members SET stripe_customer_id=?,stripe_payment_method_id=?,stripe_payment_method_brand=?,stripe_payment_method_last4=?,updated_at=? WHERE id=?`)
    .bind(customerId, paymentMethodId, clean(paymentMethod.card?.brand || paymentMethod.type, 40), clean(paymentMethod.card?.last4, 4), now(), memberId).run();
}

async function expireSession(env, session) {
  const kind = String(session.metadata?.kind || "");
  if (kind === "store_order") {
    const reservation = await env.DB.prepare(`SELECT * FROM checkout_reservations WHERE stripe_checkout_session_id=? AND status='open'`).bind(session.id).first();
    if (!reservation) return;
    await releaseOwnerInventory(env, reservation);
    await env.DB.prepare(`UPDATE checkout_reservations SET status='expired',updated_at=? WHERE id=? AND status='open'`).bind(now(), reservation.id).run();
  }
  if (kind === "gifted_giveaway") {
    const gift = await env.DB.prepare(`SELECT * FROM gifted_giveaways WHERE stripe_checkout_session_id=? AND status='pending_payment'`).bind(session.id).first();
    if (!gift) return;
    await env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=quantity+?,updated_at=? WHERE id=?`).bind(Number(gift.reserved_units), now(), gift.breaker_inventory_item_id).run();
    await env.DB.prepare(`UPDATE gifted_giveaways SET status='cancelled',reserved_units=0,updated_at=? WHERE id=? AND status='pending_payment'`).bind(now(), gift.id).run();
  }
}

async function handleRefund(env, object) {
  const paymentIntent = String(object.payment_intent || object.id || "");
  if (!paymentIntent) return;
  const reservation = await env.DB.prepare(`SELECT * FROM checkout_reservations WHERE stripe_payment_intent_id=? AND status='paid'`).bind(paymentIntent).first();
  if (reservation) {
    await releaseOwnerInventory(env, reservation, "refunded");
    const statements = [
      env.DB.prepare(`UPDATE checkout_reservations SET status='refunded',updated_at=? WHERE id=?`).bind(now(), reservation.id),
      env.DB.prepare(`UPDATE member_orders SET payment_status='refunded',status='cancelled',refunded_at=?,updated_at=? WHERE id=?`).bind(now(), now(), reservation.order_id)
    ];
    const sellerItem = await env.DB.prepare(`SELECT id,inbound_quantity FROM breaker_inventory_items WHERE member_id=? AND source_inventory_item_id=? AND unit_type='sealed_box'`).bind(reservation.member_id, reservation.inventory_item_id).first();
    if (sellerItem) statements.push(env.DB.prepare(`UPDATE breaker_inventory_items SET inbound_quantity=MAX(0,inbound_quantity-?),updated_at=? WHERE id=?`).bind(Number(reservation.quantity), now(), sellerItem.id));
    await env.DB.batch(statements);
  }
  const gift = await env.DB.prepare(`SELECT * FROM gifted_giveaways WHERE stripe_payment_intent_id=? AND status IN ('reserved','paid','queued')`).bind(paymentIntent).first();
  if (gift) {
    await env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=quantity+?,updated_at=? WHERE id=?`).bind(Number(gift.reserved_units), now(), gift.breaker_inventory_item_id).run();
    await env.DB.prepare(`UPDATE gifted_giveaways SET status='refunded',reserved_units=0,refunded_at=?,updated_at=? WHERE id=?`).bind(now(), now(), gift.id).run();
  }
}

async function handleIdentityEvent(env, event) {
  const session = event.data?.object || {};
  const memberId = String(session.metadata?.member_id || "");
  if (!validUuid(memberId)) return;
  if (event.type === "identity.verification_session.verified") {
    const member = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(memberId).first();
    if (!member?.identity_fingerprint) return;
    const collision = await env.DB.prepare(`SELECT id FROM members WHERE identity_fingerprint=? AND id<>? AND identity_status='verified'`).bind(member.identity_fingerprint, member.id).first();
    if (collision) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE members SET stripe_identity_status='manual_review',identity_status='pending_review',updated_at=? WHERE id=?`).bind(now(), member.id),
        env.DB.prepare(`INSERT INTO identity_review_queue(id,member_id,conflicting_member_id,reason,detail,created_at) VALUES(?,?,?,?,?,?)`).bind(uid(), member.id, collision.id, "identity_collision", "Stripe verified a document, but the protected identity fingerprint matches another account.", now())
      ]);
    } else {
      await env.DB.prepare(`UPDATE members SET stripe_identity_status='verified',identity_status='verified',referral_qualified_at=COALESCE(referral_qualified_at,?),updated_at=? WHERE id=?`).bind(now(), now(), member.id).run();
    }
  } else {
    const status = event.type.endsWith(".canceled") ? "cancelled" : event.type.endsWith(".redacted") ? "redacted" : "requires_input";
    await env.DB.prepare(`UPDATE members SET stripe_identity_status=?,updated_at=? WHERE id=?`).bind(status, now(), memberId).run();
  }
}

async function stripeWebhook(request, env, cors) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe webhook is not configured." }, 503, cors);
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return json({ error: "Webhook body is too large." }, 413, cors);
  const verified = await verifyStripeWebhook({ rawBody, signatureHeader: request.headers.get("Stripe-Signature") || "", secret: env.STRIPE_WEBHOOK_SECRET });
  if (!verified.ok) return json({ error: "Invalid Stripe webhook signature." }, 401, cors);
  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid Stripe webhook event." }, 400, cors); }
  if (!event.id || !event.type) return json({ error: "Invalid Stripe webhook event." }, 400, cors);
  const prior = await env.DB.prepare(`SELECT processed_at FROM stripe_webhook_events WHERE event_id=?`).bind(event.id).first();
  if (prior?.processed_at) return json({ ok: true, duplicate: true }, 200, cors);
  await env.DB.prepare(`INSERT OR IGNORE INTO stripe_webhook_events(event_id,event_type,livemode,received_at) VALUES(?,?,?,?)`).bind(event.id, event.type, event.livemode ? 1 : 0, now()).run();
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data?.object || {};
    if (session.metadata?.kind === "billing_setup") await completeBillingSetup(env, session);
    if (session.payment_status === "paid") {
      if (session.metadata?.kind === "store_order") await completeStoreOrder(env, session);
      if (session.metadata?.kind === "gifted_giveaway") await completeGift(env, session);
    }
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await expireSession(env, event.data?.object || {});
  } else if (event.type === "charge.refunded") {
    await handleRefund(env, event.data?.object || {});
  } else if (event.type.startsWith("identity.verification_session.")) {
    await handleIdentityEvent(env, event);
  }
  await env.DB.prepare(`UPDATE stripe_webhook_events SET processed_at=? WHERE event_id=?`).bind(now(), event.id).run();
  return json({ ok: true }, 200, cors);
}

async function saveBuyerContact(request, env, cors) {
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth.error;
  const data = await boundedJson(request, 7000);
  const phone = clean(data.phone, 32);
  const address = data.shippingAddress && typeof data.shippingAddress === "object" ? data.shippingAddress : {};
  const normalized = {
    name: clean(address.name || `${auth.member.first_name} ${auth.member.last_name}`, 120),
    street1: clean(address.street1, 160), street2: clean(address.street2, 160), city: clean(address.city, 100),
    state: clean(address.state, 100), postalCode: clean(address.postalCode, 32), country: clean(address.country || "US", 2).toUpperCase()
  };
  if (!/^\+?[0-9 ()-]{7,32}$/.test(phone)) return json({ error: "Enter a valid phone number, including country code when outside the USA." }, 400, cors);
  if (!normalized.name || !normalized.street1 || !normalized.city || !normalized.state || !normalized.postalCode || !/^[A-Z]{2}$/.test(normalized.country)) return json({ error: "Complete the shipping address." }, 400, cors);
  await env.DB.prepare(`UPDATE members SET phone=?,shipping_address_json=?,updated_at=? WHERE id=?`).bind(phone, JSON.stringify(normalized), now(), auth.member.id).run();
  return json({ saved: true, phone, shippingAddress: normalized }, 200, cors);
}

async function startBillingSetup(request, env, cors) {
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth.error;
  if (!auth.member.phone || !auth.member.shipping_address_json || auth.member.shipping_address_json === "{}") return json({ error: "Save your phone and shipping address before adding a payment method." }, 409, cors);
  let customerId = String(auth.member.stripe_customer_id || "");
  try {
    if (!customerId) {
      const customer = await stripeRequest(env.STRIPE_SECRET_KEY, "/customers", [
        ["email", auth.member.email], ["name", `${auth.member.first_name} ${auth.member.last_name}`], ["phone", auth.member.phone], ["metadata[member_id]", auth.member.id]
      ], `customer-${auth.member.id}`);
      customerId = customer.id;
      await env.DB.prepare(`UPDATE members SET stripe_customer_id=?,updated_at=? WHERE id=?`).bind(customerId, now(), auth.member.id).run();
    }
    const session = await stripeRequest(env.STRIPE_SECRET_KEY, "/checkout/sessions", [
      ["mode", "setup"], ["customer", customerId], ["success_url", `${siteUrl(env)}/referral.html?billing=success`],
      ["cancel_url", `${siteUrl(env)}/referral.html?billing=cancelled`], ["payment_method_types[0]", "card"],
      ["metadata[kind]", "billing_setup"], ["metadata[member_id]", auth.member.id], ["setup_intent_data[metadata][member_id]", auth.member.id]
    ], `billing-setup-${auth.member.id}-${Date.now().toString().slice(0, -5)}`);
    return json({ url: session.url }, 201, cors);
  } catch (error) {
    return json({ error: error.message === "STRIPE_NOT_CONFIGURED" ? "Stripe billing is not configured." : "Stripe could not open payment setup." }, 503, cors);
  }
}

function playbackUrl(env, liveInputUid) {
  const uidValue = String(liveInputUid || "");
  const customer = String(env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!uidValue || !customer || !/^[A-Za-z0-9.-]+$/.test(customer)) return "";
  const host = customer.includes(".") ? customer : `${customer}.cloudflarestream.com`;
  return `https://${host}/${encodeURIComponent(uidValue)}/iframe?autoplay=true&muted=false`;
}

function auctionView(row, viewerId = "", env = {}) {
  if (!row) return null;
  const current = Number(row.current_bid_cents ?? row.starting_bid_cents);
  const increment = Number(row.bid_increment_cents);
  const bannerUntil = row.winner_banner_until ? Date.parse(row.winner_banner_until) : 0;
  return {
    id: row.id, sessionId: row.session_id, sellerId: row.member_id, title: row.title, description: row.description || "",
    status: row.status, startingBidCents: Number(row.starting_bid_cents), bidIncrementCents: increment,
    currentBidCents: current, minNextBidCents: current + increment, imageUrl: row.image_url || "",
    condition: row.item_condition || "", saleType: row.sale_type || "sealed", viewerCount: Number(row.viewer_count || 0),
    viewerBidState: !viewerId || !row.winning_member_id ? "ready" : row.winning_member_id === viewerId ? "winning" : "losing",
    showWinnerBanner: row.status === "sold" && bannerUntil > Date.now(), winningDisplay: row.winning_display || "CRACKPACKS buyer",
    playbackUrl: playbackUrl(env, row.cloudflare_live_input_uid)
  };
}

async function currentAuction(request, env, cors, url) {
  const member = await memberFromRequest(request, env);
  const requestedShow = String(url.searchParams.get("show") || "");
  if (requestedShow && !validUuid(requestedShow)) return json({ error: "Choose a valid live show." }, 400, cors);
  const row = await env.DB.prepare(`
    SELECT lot.*,session.viewer_count,session.cloudflare_live_input_uid,winner.live_username winning_display
    FROM breaker_auction_lots lot JOIN breaker_stream_sessions session ON session.id=lot.session_id
    LEFT JOIN members winner ON winner.id=lot.winning_member_id
    WHERE (?='' OR session.id=?) AND lot.status IN ('live','sold') AND (lot.status='live' OR lot.winner_banner_until>?)
    ORDER BY CASE lot.status WHEN 'live' THEN 0 ELSE 1 END,lot.updated_at DESC LIMIT 1
  `).bind(requestedShow, requestedShow, now()).first();
  let show = null;
  const showId = requestedShow || row?.session_id || "";
  if (showId) {
    const session = await env.DB.prepare(`SELECT id,title,status,viewer_count,cloudflare_live_input_uid FROM breaker_stream_sessions WHERE id=? AND status IN ('open','live','recording_ready')`).bind(showId).first();
    if (session) show = { id: session.id, title: session.title, status: session.status, viewerCount: Number(session.viewer_count || 0), playbackUrl: playbackUrl(env, session.cloudflare_live_input_uid) };
  }
  return json({ lot: auctionView(row, member?.id || "", env), show, serverNow: now() }, 200, cors);
}

async function viewerHeartbeat(request, env, cors) {
  const data = await boundedJson(request, 1500);
  const showId = String(data.showId || "");
  const clientId = String(data.clientId || "");
  if (!validUuid(showId) || !/^[A-Za-z0-9_-]{16,80}$/.test(clientId)) return json({ error: "Invalid viewer heartbeat." }, 400, cors);
  const show = await env.DB.prepare(`SELECT id FROM breaker_stream_sessions WHERE id=? AND status IN ('open','live')`).bind(showId).first();
  if (!show) return json({ error: "This show is not active." }, 410, cors);
  const member = await memberFromRequest(request, env);
  const viewerKey = member ? `member:${member.id}` : `guest:${await digest(`${clientId}:${request.headers.get("CF-Connecting-IP") || ""}`, env.AUTH_SECRET)}`;
  const stamp = now();
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO stream_viewer_presence(stream_session_id,viewer_key,last_seen_at) VALUES(?,?,?) ON CONFLICT(stream_session_id,viewer_key) DO UPDATE SET last_seen_at=excluded.last_seen_at`).bind(showId, viewerKey, stamp),
    env.DB.prepare(`DELETE FROM stream_viewer_presence WHERE stream_session_id=? AND last_seen_at<?`).bind(showId, cutoff)
  ]);
  const count = await env.DB.prepare(`SELECT COUNT(*) count FROM stream_viewer_presence WHERE stream_session_id=? AND last_seen_at>=?`).bind(showId, cutoff).first();
  const viewers = Number(count?.count || 0);
  await env.DB.prepare(`UPDATE breaker_stream_sessions SET viewer_count=?,updated_at=? WHERE id=?`).bind(viewers, stamp, showId).run();
  return json({ viewers }, 200, cors);
}

async function placeBid(request, env, cors, lotId) {
  if (String(env.LIVE_AUCTIONS_ENABLED || "false") !== "true") return json({ error: "Live bidding is locked until the production auction payment review is complete." }, 503, cors);
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth.error;
  if (!auth.member.stripe_payment_method_id || !auth.member.phone || auth.member.shipping_address_json === "{}") {
    return json({ error: "Add a Stripe payment method, phone number, and shipping address in Profile before bidding." }, 409, cors);
  }
  const data = await boundedJson(request, 2000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lot = await env.DB.prepare(`SELECT * FROM breaker_auction_lots WHERE id=? AND status='live'`).bind(lotId).first();
    if (!lot) return json({ error: "This auction is no longer live." }, 410, cors);
    if (lot.member_id === auth.member.id) return json({ error: "Sellers cannot bid on their own auction." }, 403, cors);
    if (lot.closes_at && Date.parse(lot.closes_at) <= Date.now()) return json({ error: "This auction has closed." }, 410, cors);
    const current = Number(lot.current_bid_cents ?? lot.starting_bid_cents);
    const minimum = current + Number(lot.bid_increment_cents);
    const requested = data.bidAmount === undefined ? minimum : Math.round(Number(data.bidAmount) * 100);
    if (!Number.isInteger(requested) || requested < minimum) return json({ error: `Minimum required bid is $${(minimum / 100).toFixed(2)}.`, minimumCents: minimum }, 409, cors);
    const changed = await env.DB.prepare(`UPDATE breaker_auction_lots SET current_bid_cents=?,winning_member_id=?,updated_at=? WHERE id=? AND status='live' AND COALESCE(current_bid_cents,starting_bid_cents)=?`)
      .bind(requested, auth.member.id, now(), lot.id, current).run();
    if (Number(changed.meta?.changes || 0) !== 1) continue;
    await env.DB.batch([
      env.DB.prepare(`UPDATE breaker_auction_bids SET status='outbid' WHERE lot_id=? AND status='leading'`).bind(lot.id),
      env.DB.prepare(`INSERT INTO breaker_auction_bids(id,lot_id,bidder_member_id,amount_cents,status,created_at) VALUES(?,?,?,?,?,?)`).bind(uid(), lot.id, auth.member.id, requested, "leading", now())
    ]);
    const updated = await env.DB.prepare(`SELECT lot.*,session.viewer_count,session.cloudflare_live_input_uid,winner.live_username winning_display FROM breaker_auction_lots lot JOIN breaker_stream_sessions session ON session.id=lot.session_id LEFT JOIN members winner ON winner.id=lot.winning_member_id WHERE lot.id=?`).bind(lot.id).first();
    return json({ lot: auctionView(updated, auth.member.id, env) }, 201, cors);
  }
  return json({ error: "The bid changed while yours was being placed. Review the new minimum and try again." }, 409, cors);
}

async function verifySale(request, env, cors, url) {
  const saleId = String(url.searchParams.get("sale") || "");
  const token = String(url.searchParams.get("token") || "");
  if (!validUuid(saleId) || token.length < 24) return json({ error: "This Verify Order link is invalid." }, 400, cors);
  const tokenHash = await digest(token, env.AUTH_SECRET);
  const row = await env.DB.prepare(`
    SELECT sale.*,item.product_name,seller.email,seller.live_username
    FROM breaker_sales sale JOIN breaker_inventory_items item ON item.id=sale.breaker_inventory_item_id
    JOIN members seller ON seller.id=sale.member_id
    WHERE sale.id=? AND sale.buyer_verify_token_hash=?
  `).bind(saleId, tokenHash).first();
  if (!row) return json({ error: "This Verify Order link was not found or has expired." }, 404, cors);
  return json({ sale: {
    id: row.id, productName: row.product_name, quantity: Number(row.quantity), saleOccurredAt: row.sale_occurred_at,
    streamOffsetSeconds: row.stream_offset_seconds === null ? null : Number(row.stream_offset_seconds), clipStartedAt: row.clip_started_at,
    clipEndedAt: row.clip_ended_at, clipUrl: row.clip_url || "", streamRecordingUrl: row.stream_recording_url || "",
    clipMethod: row.clip_method || "pending", clipDurationSeconds: row.clip_duration_seconds === null ? null : Number(row.clip_duration_seconds),
    clipError: row.clip_error || "", sellerUsername: row.live_username || "", email: row.email || "", verificationStatus: row.verification_status
  } }, 200, cors);
}

async function purchaseOrderLabel(request, env, cors, orderId) {
  const auth = await requireOwner(request, env, cors);
  if (auth.error) return auth.error;
  const row = await env.DB.prepare(`
    SELECT orders.*,reservation.easypost_shipment_id,reservation.easypost_rate_id,reservation.carrier,reservation.service,
           shipment.label_purchased_at,shipment.postage_label_url,shipment.postage_label_pdf_url
    FROM member_orders orders LEFT JOIN checkout_reservations reservation ON reservation.order_id=orders.id
    LEFT JOIN order_shipments shipment ON shipment.order_id=orders.id
    WHERE orders.id=? AND orders.owner_member_id=?
  `).bind(orderId, auth.member.id).first();
  if (!row) return json({ error: "Order not found." }, 404, cors);
  if (row.payment_status !== "paid") return json({ error: "A shipping label can only be purchased for a paid order." }, 409, cors);
  if (row.label_purchased_at) return json({ ordered: true, labelUrl: row.postage_label_pdf_url || row.postage_label_url, purchasedAt: row.label_purchased_at }, 200, cors);
  if (!row.easypost_shipment_id || !row.easypost_rate_id) return json({ error: "This order has no saved EasyPost shipment and rate. Create the label manually." }, 409, cors);
  const apiKey = env.EASYPOST_API_KEY || "";
  if (!apiKey) return json({ error: "EasyPost production label purchasing is not configured." }, 503, cors);
  const result = await fetch(`https://api.easypost.com/v2/shipments/${encodeURIComponent(row.easypost_shipment_id)}/buy`, {
    method: "POST", headers: { Authorization: `Basic ${btoa(`${apiKey}:`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ rate: { id: row.easypost_rate_id } })
  });
  const shipment = await result.json().catch(() => ({}));
  if (!result.ok || !shipment.tracker?.id || !shipment.tracking_code) {
    console.error("EasyPost label purchase failed", { status: result.status, code: shipment?.error?.code || "" });
    return json({ error: "EasyPost could not purchase this label. No ordered badge was saved." }, 502, cors);
  }
  const stamp = now();
  const rateCents = Math.round(Number(shipment.selected_rate?.rate || 0) * 100);
  const labelUrl = String(shipment.postage_label?.label_url || "").slice(0, 500);
  const pdfUrl = String(shipment.postage_label?.label_pdf_url || "").slice(0, 500);
  const existing = await env.DB.prepare(`SELECT id FROM order_shipments WHERE order_id=?`).bind(orderId).first();
  if (existing) {
    await env.DB.prepare(`UPDATE order_shipments SET easypost_tracker_id=?,easypost_shipment_id=?,easypost_rate_id=?,mode=?,carrier=?,tracking_code=?,status=?,postage_label_url=?,postage_label_pdf_url=?,label_file_type=?,label_rate_cents=?,label_purchased_at=?,updated_at=? WHERE order_id=?`)
      .bind(shipment.tracker.id, shipment.id, row.easypost_rate_id, shipment.mode === "production" ? "production" : "test", clean(shipment.tracker.carrier || row.carrier, 60), clean(shipment.tracking_code, 120), clean(shipment.tracker.status || "pre_transit", 40), labelUrl, pdfUrl, clean(shipment.postage_label?.label_file_type || "PDF", 20), rateCents, stamp, stamp, orderId).run();
  } else {
    await env.DB.prepare(`INSERT INTO order_shipments(id,order_id,easypost_tracker_id,mode,carrier,tracking_code,status,status_detail,carrier_public_url,tracking_details_json,created_at,updated_at,easypost_shipment_id,easypost_rate_id,postage_label_url,postage_label_pdf_url,label_file_type,label_rate_cents,label_purchased_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(uid(), orderId, shipment.tracker.id, shipment.mode === "production" ? "production" : "test", clean(shipment.tracker.carrier || row.carrier, 60), clean(shipment.tracking_code, 120), clean(shipment.tracker.status || "pre_transit", 40), "", String(shipment.tracker.public_url || "").slice(0, 500), "[]", stamp, stamp, shipment.id, row.easypost_rate_id, labelUrl, pdfUrl, clean(shipment.postage_label?.label_file_type || "PDF", 20), rateCents, stamp).run();
  }
  return json({ ordered: true, labelUrl: pdfUrl || labelUrl, purchasedAt: stamp, trackingCode: shipment.tracking_code }, 201, cors);
}

async function listShows(request, env, cors) {
  const viewer = await memberFromRequest(request, env);
  const rows = await env.DB.prepare(`
    SELECT session.*,seller.live_username,seller.id seller_member_id,
      EXISTS(SELECT 1 FROM stream_watchlists watch WHERE watch.stream_session_id=session.id AND watch.member_id=?) saved,
      EXISTS(SELECT 1 FROM stream_follows follow WHERE follow.seller_member_id=session.member_id AND follow.follower_member_id=?) followed
    FROM breaker_stream_sessions session JOIN members seller ON seller.id=session.member_id
    JOIN breaker_profiles profile ON profile.member_id=session.member_id AND profile.status='active'
    WHERE session.status IN ('open','live','recording_ready') OR (session.scheduled_at IS NOT NULL AND session.scheduled_at>?)
    ORDER BY CASE session.status WHEN 'live' THEN 0 ELSE 1 END,COALESCE(session.scheduled_at,session.started_at) ASC LIMIT 100
  `).bind(viewer?.id || "", viewer?.id || "", now()).all();
  return json({ shows: (rows.results || []).map(row => ({
    id: row.id, sellerId: row.seller_member_id, sellerUsername: row.live_username || "Seller", title: row.title || "Crack Packs live show",
    state: row.status === "live" ? "live" : "upcoming", viewers: Number(row.viewer_count || 0), image: row.thumbnail_url || "assets/images/banner-cosmic.svg",
    startsAt: row.scheduled_at || row.started_at, saved: Boolean(row.saved), followed: Boolean(row.followed), streamUid: row.cloudflare_recording_video_uid || ""
  })) }, 200, cors);
}

async function giftCatalog(request, env, cors, url) {
  const showId = String(url.searchParams.get("show") || "");
  if (!validUuid(showId)) return json({ error: "Choose a valid seller show." }, 400, cors);
  const rows = await env.DB.prepare(`
    SELECT bi.id,bi.product_name,bi.quantity,bi.unit_type,source.live_list_price_cents,source.website_list_price_cents
    FROM breaker_inventory_items bi JOIN breaker_stream_sessions session ON session.member_id=bi.member_id AND session.id=?
    LEFT JOIN inventory_items source ON source.id=bi.source_inventory_item_id
    WHERE bi.quantity>0 AND session.status IN ('open','live') ORDER BY bi.product_name COLLATE NOCASE
  `).bind(showId).all();
  return json({ items: (rows.results || []).map(row => ({
    id: row.id, name: row.product_name, quantity: Number(row.quantity), unitType: row.unit_type,
    priceCents: Number(row.live_list_price_cents ?? row.website_list_price_cents ?? 0), currency: "USD"
  })).filter(item => item.priceCents >= 50) }, 200, cors);
}

async function updateWatchOrFollow(request, env, cors, kind) {
  const auth = await requireMember(request, env, cors);
  if (auth.error) return auth.error;
  const data = await boundedJson(request, 1200);
  const enabled = data.enabled !== false;
  if (kind === "watch") {
    const showId = String(data.showId || "");
    if (!validUuid(showId)) return json({ error: "Choose a valid show." }, 400, cors);
    if (enabled) await env.DB.prepare(`INSERT OR IGNORE INTO stream_watchlists(member_id,stream_session_id,created_at) VALUES(?,?,?)`).bind(auth.member.id, showId, now()).run();
    else await env.DB.prepare(`DELETE FROM stream_watchlists WHERE member_id=? AND stream_session_id=?`).bind(auth.member.id, showId).run();
  } else {
    const sellerId = String(data.sellerId || "");
    if (!validUuid(sellerId) || sellerId === auth.member.id) return json({ error: "Choose another valid seller." }, 400, cors);
    if (enabled) await env.DB.prepare(`INSERT OR IGNORE INTO stream_follows(follower_member_id,seller_member_id,created_at) VALUES(?,?,?)`).bind(auth.member.id, sellerId, now()).run();
    else await env.DB.prepare(`DELETE FROM stream_follows WHERE follower_member_id=? AND seller_member_id=?`).bind(auth.member.id, sellerId).run();
  }
  return json({ ok: true, enabled }, 200, cors);
}

async function sellerGiveaways(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const [saved, gifted] = await Promise.all([
      env.DB.prepare(`SELECT * FROM seller_giveaways WHERE owner_member_id=? ORDER BY updated_at DESC`).bind(auth.member.id).all(),
      env.DB.prepare(`SELECT * FROM gifted_giveaways WHERE owner_member_id=? AND status IN ('reserved','queued','launched','fulfilled') ORDER BY updated_at DESC`).bind(auth.member.id).all()
    ]);
    return json({ saved: saved.results || [], gifted: gifted.results || [] }, 200, cors);
  }
  const data = await boundedJson(request, 4000);
  const title = clean(data.title, 100);
  const inventoryLabel = clean(data.inventoryLabel, 100);
  const quantity = Number(data.quantity || 1);
  if (!title || !inventoryLabel || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return json({ error: "Enter a title, inventory label, and 1–50 winners." }, 400, cors);
  const giveawayId = uid();
  await env.DB.prepare(`INSERT INTO seller_giveaways(id,owner_member_id,show_id,title,quantity,inventory_label,eligibility_profile,open_mode,rules,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)`)
    .bind(giveawayId, auth.member.id, clean(data.showId, 80), title, quantity, inventoryLabel, clean(data.eligibilityProfile, 100), clean(data.openMode, 100), clean(data.rules, 500), now(), now()).run();
  return json({ id: giveawayId, status: "draft" }, 201, cors);
}

async function maybeCreateReorder(env, item) {
  if (!item || !Number(item.auto_reorder_enabled) || Number(item.quantity) >= Number(item.par_quantity)) return;
  const requested = Math.max(1, Number(item.reorder_quantity) || Number(item.par_quantity) - Number(item.quantity));
  const reorderId = uid(); const stamp = now();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO breaker_reorder_requests(id,member_id,breaker_inventory_item_id,source_inventory_item_id,product_name,unit_type,requested_quantity,trigger_quantity,par_quantity,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending_review','auto_par',?,?)`)
    .bind(reorderId, item.member_id, item.id, item.source_inventory_item_id || null, item.product_name, item.unit_type, requested, Number(item.quantity), Number(item.par_quantity), stamp, stamp).run();
  if (Number(inserted.meta?.changes || 0) === 1) {
    await env.DB.prepare(`UPDATE breaker_inventory_items SET pending_reorder_quantity=?,updated_at=? WHERE id=?`).bind(requested, stamp, item.id).run();
  }
}

async function sellerInventory(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT bi.*,source.name source_name,source.website_list_price_cents,source.live_list_price_cents FROM breaker_inventory_items bi LEFT JOIN inventory_items source ON source.id=bi.source_inventory_item_id WHERE bi.member_id=? ORDER BY bi.product_name COLLATE NOCASE`).bind(auth.member.id).all();
    const reorders = await env.DB.prepare(`SELECT * FROM breaker_reorder_requests WHERE member_id=? AND status IN ('pending_review','approved','ordered') ORDER BY created_at DESC`).bind(auth.member.id).all();
    return json({ items: rows.results || [], reorders: reorders.results || [] }, 200, cors);
  }
  const data = await boundedJson(request, 4000);
  const sourceId = String(data.sourceInventoryItemId || "");
  const source = sourceId ? await env.DB.prepare(`SELECT id,sku,name FROM inventory_items WHERE id=? AND is_active=1`).bind(sourceId).first() : null;
  if (sourceId && !source) return json({ error: "That Crack Packs store product is unavailable." }, 404, cors);
  const productName = clean(source?.name || data.productName, 160);
  const sku = clean(source?.sku || data.sku, 64);
  const unitType = ["sealed_box","pack","single","supply"].includes(data.unitType) ? data.unitType : "sealed_box";
  const quantity = Number(data.quantity || 0); const par = Number(data.parQuantity || 0); const reorder = Number(data.reorderQuantity || 0);
  if (!productName || !Number.isInteger(quantity) || quantity < 0 || quantity > 100000 || !Number.isInteger(par) || par < 0 || !Number.isInteger(reorder) || reorder < 0) return json({ error: "Enter a valid product and inventory quantities." }, 400, cors);
  const existing = source ? await env.DB.prepare(`SELECT * FROM breaker_inventory_items WHERE member_id=? AND source_inventory_item_id=? AND unit_type=?`).bind(auth.member.id, source.id, unitType).first() : null;
  const itemId = existing?.id || uid(); const stamp = now();
  if (existing) {
    await env.DB.prepare(`UPDATE breaker_inventory_items SET sku=?,product_name=?,quantity=?,par_quantity=?,reorder_quantity=?,auto_reorder_enabled=?,updated_at=? WHERE id=? AND member_id=?`)
      .bind(sku, productName, quantity, par, reorder, data.autoReorder ? 1 : 0, stamp, itemId, auth.member.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO breaker_inventory_items(id,member_id,source_inventory_item_id,sku,product_name,unit_type,packs_per_unit,quantity,par_quantity,reorder_quantity,auto_reorder_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(itemId, auth.member.id, source?.id || null, sku, productName, unitType, data.packsPerUnit ? Number(data.packsPerUnit) : null, quantity, par, reorder, data.autoReorder ? 1 : 0, stamp, stamp).run();
  }
  await env.DB.prepare(`INSERT INTO breaker_inventory_movements(id,breaker_inventory_item_id,member_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(uid(), itemId, auth.member.id, "manual_set", existing ? quantity - Number(existing.quantity) : quantity, quantity, "Seller inventory saved", stamp).run();
  const item = await env.DB.prepare(`SELECT * FROM breaker_inventory_items WHERE id=?`).bind(itemId).first();
  await maybeCreateReorder(env, item);
  return json({ item }, existing ? 200 : 201, cors);
}

async function adjustSellerInventory(request, env, cors, itemId) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const data = await boundedJson(request, 2500);
  const action = ["received","sale","break_packs_added","correction"].includes(data.action) ? data.action : "";
  const units = Number(data.quantity);
  if (!action || !Number.isInteger(units) || units < 1 || units > 100000) return json({ error: "Choose a valid inventory action and quantity." }, 400, cors);
  const item = await env.DB.prepare(`SELECT * FROM breaker_inventory_items WHERE id=? AND member_id=?`).bind(itemId, auth.member.id).first();
  if (!item) return json({ error: "Seller inventory item not found." }, 404, cors);
  const delta = action === "sale" ? -units : units;
  const resulting = Number(item.quantity) + delta;
  if (resulting < 0 || resulting > 100000) return json({ error: "That adjustment would create an invalid stock count." }, 409, cors);
  const stamp = now();
  const changed = await env.DB.prepare(`UPDATE breaker_inventory_items SET quantity=?,sold_7d=sold_7d+?,sold_30d=sold_30d+?,last_sale_at=CASE WHEN ?='sale' THEN ? ELSE last_sale_at END,updated_at=? WHERE id=? AND member_id=? AND quantity=?`)
    .bind(resulting, action === "sale" ? units : 0, action === "sale" ? units : 0, action, stamp, stamp, item.id, auth.member.id, Number(item.quantity)).run();
  if (Number(changed.meta?.changes || 0) !== 1) return json({ error: "Inventory changed at the same time. Refresh and try again." }, 409, cors);
  await env.DB.prepare(`INSERT INTO breaker_inventory_movements(id,breaker_inventory_item_id,member_id,movement_type,delta_quantity,resulting_quantity,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(uid(), item.id, auth.member.id, action, delta, resulting, clean(data.note, 300), stamp).run();
  const updated = await env.DB.prepare(`SELECT * FROM breaker_inventory_items WHERE id=?`).bind(item.id).first();
  await maybeCreateReorder(env, updated);
  return json({ item: updated }, 200, cors);
}

async function adminReorders(request, env, cors, reorderId = "") {
  const auth = await requireOwner(request, env, cors);
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT reorder.*,member.email,member.live_username FROM breaker_reorder_requests reorder JOIN members member ON member.id=reorder.member_id WHERE reorder.status IN ('pending_review','approved','ordered') ORDER BY reorder.created_at ASC LIMIT 200`).all();
    return json({ reorders: rows.results || [] }, 200, cors);
  }
  const data = await boundedJson(request, 1200);
  const status = ["approved","ordered","rejected","cancelled"].includes(data.status) ? data.status : "";
  if (!status) return json({ error: "Choose a valid reorder status." }, 400, cors);
  const reorder = await env.DB.prepare(`SELECT * FROM breaker_reorder_requests WHERE id=?`).bind(reorderId).first();
  if (!reorder) return json({ error: "Reorder request not found." }, 404, cors);
  await env.DB.batch([
    env.DB.prepare(`UPDATE breaker_reorder_requests SET status=?,reviewed_by_member_id=?,reviewed_at=?,updated_at=? WHERE id=?`).bind(status, auth.member.id, now(), now(), reorder.id),
    env.DB.prepare(`UPDATE breaker_inventory_items SET pending_reorder_quantity=CASE WHEN ? IN ('rejected','cancelled') THEN 0 ELSE pending_reorder_quantity END,updated_at=? WHERE id=?`).bind(status, now(), reorder.breaker_inventory_item_id)
  ]);
  return json({ ok: true, status }, 200, cors);
}

async function cloudflareRequest(env, path, options = {}) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_API_TOKEN) throw new Error("STREAM_NOT_CONFIGURED");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error("STREAM_PROVIDER_ERROR");
  return payload.result || payload;
}

async function sellerStreamInput(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  let input = await env.DB.prepare(`SELECT * FROM breaker_stream_inputs WHERE member_id=?`).bind(auth.member.id).first();
  if (!input && request.method === "POST") {
    let created;
    try {
      created = await cloudflareRequest(env, "/live_inputs", { method: "POST", body: JSON.stringify({ meta: { name: `${auth.member.live_username || "seller"} Crack Packs input` }, recording: { mode: "automatic" } }) });
    } catch (error) {
      return json({ error: error.message === "STREAM_NOT_CONFIGURED" ? "Cloudflare Stream credentials are not configured." : "Cloudflare could not create the live input." }, 503, cors);
    }
    const stamp = now();
    const rtmps = created.rtmps || {};
    const srt = created.srt || {};
    await env.DB.prepare(`INSERT INTO breaker_stream_inputs(member_id,cloudflare_live_input_uid,rtmps_url,rtmps_stream_key,srt_url,srt_stream_id,srt_passphrase,status,created_by_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(auth.member.id, created.uid, clean(rtmps.url, 300), clean(rtmps.streamKey, 500), clean(srt.url, 500), clean(srt.streamId, 300), clean(srt.passphrase, 300), "enabled", auth.member.id, stamp, stamp).run();
    input = await env.DB.prepare(`SELECT * FROM breaker_stream_inputs WHERE member_id=?`).bind(auth.member.id).first();
  }
  return json({ input: input ? { uid: input.cloudflare_live_input_uid, rtmpsUrl: input.rtmps_url, streamKey: input.rtmps_stream_key, srtUrl: input.srt_url, srtStreamId: input.srt_stream_id, srtPassphrase: input.srt_passphrase, status: input.status } : null }, 200, cors);
}

async function sellerShows(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT * FROM breaker_stream_sessions WHERE member_id=? ORDER BY started_at DESC LIMIT 100`).bind(auth.member.id).all();
    return json({ shows: rows.results || [] }, 200, cors);
  }
  const data = await boundedJson(request, 5000);
  const title = clean(data.title, 160);
  if (!title) return json({ error: "Enter a show title." }, 400, cors);
  const input = await env.DB.prepare(`SELECT * FROM breaker_stream_inputs WHERE member_id=? AND status<>'disabled'`).bind(auth.member.id).first();
  if (!input) return json({ error: "Create your private OBS stream input first." }, 409, cors);
  const scheduledAt = data.scheduledAt && Number.isFinite(Date.parse(data.scheduledAt)) ? new Date(data.scheduledAt).toISOString() : null;
  const showId = uid(); const stamp = now();
  const slug = `${clean(auth.member.live_username || "seller", 32).toLowerCase()}-${showId.slice(0, 8)}`;
  await env.DB.prepare(`INSERT INTO breaker_stream_sessions(id,member_id,cloudflare_live_input_uid,title,status,started_at,created_at,updated_at,public_slug,scheduled_at,thumbnail_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(showId, auth.member.id, input.cloudflare_live_input_uid, title, "open", scheduledAt || stamp, stamp, stamp, slug, scheduledAt, clean(data.thumbnailUrl, 500)).run();
  return json({ id: showId, slug, status: "open" }, 201, cors);
}

async function sellerShowLots(request, env, cors, showId) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const show = await env.DB.prepare(`SELECT * FROM breaker_stream_sessions WHERE id=? AND member_id=?`).bind(showId, auth.member.id).first();
  if (!show) return json({ error: "Show not found." }, 404, cors);
  const rows = await env.DB.prepare(`
    SELECT lot.*,winner.live_username winning_display
    FROM breaker_auction_lots lot LEFT JOIN members winner ON winner.id=lot.winning_member_id
    WHERE lot.session_id=? AND lot.member_id=? ORDER BY lot.created_at DESC LIMIT 200
  `).bind(showId, auth.member.id).all();
  return json({ show, lots: rows.results || [] }, 200, cors);
}

async function endSellerShow(request, env, cors, showId) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const stamp = now();
  const changed = await env.DB.prepare(`UPDATE breaker_stream_sessions SET status='ended',ended_at=?,updated_at=? WHERE id=? AND member_id=? AND status IN ('open','live')`)
    .bind(stamp, stamp, showId, auth.member.id).run();
  if (Number(changed.meta?.changes || 0) !== 1) return json({ error: "That show is already ended or was not found." }, 409, cors);
  await env.DB.prepare(`UPDATE breaker_auction_lots SET status='cancelled',updated_at=? WHERE session_id=? AND member_id=? AND status IN ('scheduled','live')`)
    .bind(stamp, showId, auth.member.id).run();
  return json({ ended: true, endedAt: stamp }, 200, cors);
}

async function createAuctionLot(request, env, cors, showId) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const show = await env.DB.prepare(`SELECT id FROM breaker_stream_sessions WHERE id=? AND member_id=? AND status IN ('open','live')`).bind(showId, auth.member.id).first();
  if (!show) return json({ error: "Show not found or already ended." }, 404, cors);
  const data = await boundedJson(request, 5000);
  const title = clean(data.title, 160);
  const startingBid = Math.round(Number(data.startingBid) * 100);
  const increment = Math.round(Number(data.bidIncrement || 1) * 100);
  if (!title || !Number.isInteger(startingBid) || startingBid < 1 || !Number.isInteger(increment) || increment < 1) return json({ error: "Enter a title, starting bid, and bid increment." }, 400, cors);
  const lotId = uid();
  await env.DB.prepare(`INSERT INTO breaker_auction_lots(id,session_id,member_id,title,description,status,starting_bid_cents,bid_increment_cents,created_at,updated_at,image_url,item_condition,sale_type) VALUES(?,?,?,?,?,'scheduled',?,?,?,?,?,?,?)`)
    .bind(lotId, showId, auth.member.id, title, clean(data.description, 1000), startingBid, increment, now(), now(), clean(data.imageUrl, 500), clean(data.condition, 80), ["cards","breaks","singles","sealed","rip_ship","rtyh","buy_ship"].includes(data.saleType) ? data.saleType : "sealed").run();
  return json({ id: lotId, status: "scheduled" }, 201, cors);
}

async function changeAuctionStatus(request, env, cors, lotId, action) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const lot = await env.DB.prepare(`SELECT * FROM breaker_auction_lots WHERE id=? AND member_id=?`).bind(lotId, auth.member.id).first();
  if (!lot) return json({ error: "Auction lot not found." }, 404, cors);
  if (action === "open") {
    if (String(env.LIVE_AUCTIONS_ENABLED || "false") !== "true") return json({ error: "Live auctions are locked until production payment and seller payout review is complete." }, 503, cors);
    await env.DB.batch([
      env.DB.prepare(`UPDATE breaker_auction_lots SET status='cancelled',updated_at=? WHERE member_id=? AND status='live' AND id<>?`).bind(now(), auth.member.id, lot.id),
      env.DB.prepare(`UPDATE breaker_auction_lots SET status='live',opened_at=?,current_bid_cents=NULL,winning_member_id=NULL,updated_at=? WHERE id=? AND status='scheduled'`).bind(now(), now(), lot.id),
      env.DB.prepare(`UPDATE breaker_stream_sessions SET status='live',updated_at=? WHERE id=?`).bind(now(), lot.session_id)
    ]);
  } else {
    const bannerUntil = new Date(Date.now() + 5000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE breaker_auction_lots SET status=CASE WHEN winning_member_id IS NULL THEN 'cancelled' ELSE 'sold' END,sold_at=?,winner_banner_until=?,updated_at=? WHERE id=? AND status='live'`).bind(now(), bannerUntil, now(), lot.id),
      env.DB.prepare(`UPDATE breaker_auction_bids SET status='winning' WHERE lot_id=? AND bidder_member_id=(SELECT winning_member_id FROM breaker_auction_lots WHERE id=?) AND status='leading'`).bind(lot.id, lot.id)
    ]);
  }
  const updated = await env.DB.prepare(`SELECT lot.*,session.viewer_count,session.cloudflare_live_input_uid,winner.live_username winning_display FROM breaker_auction_lots lot JOIN breaker_stream_sessions session ON session.id=lot.session_id LEFT JOIN members winner ON winner.id=lot.winning_member_id WHERE lot.id=?`).bind(lot.id).first();
  return json({ lot: auctionView(updated, auth.member.id, env) }, 200, cors);
}

export async function handlePlatformRoute(request, env, cors) {
  const url = new URL(request.url);
  if (url.pathname === "/webhooks/stripe" && request.method === "POST") return stripeWebhook(request, env, cors);
  if (url.pathname === "/store/checkout" && request.method === "POST") return createStoreCheckout(request, env, cors);
  if (url.pathname === "/gifted-giveaways/checkout" && request.method === "POST") return createGiftCheckout(request, env, cors);
  if (url.pathname === "/profile/contact" && request.method === "POST") return saveBuyerContact(request, env, cors);
  if (url.pathname === "/billing/setup" && request.method === "POST") return startBillingSetup(request, env, cors);
  if (url.pathname === "/portal/status" && request.method === "GET") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    const profile = await sellerProfile(env, auth.member.id);
    const owner = normalizeEmail(auth.member.email) === normalizeEmail(env.ADMIN_EMAIL);
    return json({ activePortal: auth.member.active_portal || "buyer", sellerAccess: owner || profile?.status === "active", sellerStatus: owner ? "owner" : profile?.status || "not_applied" }, 200, cors);
  }
  if (url.pathname === "/portal/mode" && request.method === "POST") {
    const auth = await requireMember(request, env, cors);
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1000);
    const mode = data.mode === "seller" ? "seller" : "buyer";
    if (mode === "seller" && normalizeEmail(auth.member.email) !== normalizeEmail(env.ADMIN_EMAIL) && (await sellerProfile(env, auth.member.id))?.status !== "active") return json({ error: "Seller Portal access has not been activated for this account." }, 403, cors);
    await env.DB.prepare(`UPDATE members SET active_portal=?,updated_at=? WHERE id=?`).bind(mode, now(), auth.member.id).run();
    return json({ activePortal: mode }, 200, cors);
  }
  if (url.pathname === "/profile/live-username" && request.method === "POST") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1000);
    const username = clean(data.liveUsername, 32);
    if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) return json({ error: "User ID must be 3–32 characters, start with a letter, and use only letters, numbers, or underscores." }, 400, cors);
    const key = usernameKey(username);
    if (key.length < 3) return json({ error: "Choose a more distinctive User ID." }, 400, cors);
    const rows = await env.DB.prepare(`SELECT id,live_username_key FROM members WHERE id<>? AND live_username_key IS NOT NULL`).bind(auth.member.id).all();
    const collision = (rows.results || []).find(row => row.live_username_key === key || row.live_username_key.startsWith(key) || key.startsWith(row.live_username_key));
    if (collision) return json({ error: "That User ID is already used or is too similar to an existing User ID." }, 409, cors);
    await env.DB.prepare(`UPDATE members SET live_username=?,live_username_key=?,updated_at=? WHERE id=?`).bind(username, key, now(), auth.member.id).run();
    return json({ liveUsername: username }, 200, cors);
  }
  if (url.pathname === "/identity/session" && request.method === "POST") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    if (!auth.member.device_verified || !auth.member.first_name || !auth.member.last_name || !auth.member.birth_date || !auth.member.live_username) return json({ error: "Complete your legal profile and passkey before Stripe Identity verification." }, 403, cors);
    if (auth.member.stripe_identity_status === "verified") return json({ verified: true }, 200, cors);
    let session;
    try {
      session = await stripeRequest(env.STRIPE_SECRET_KEY, "/identity/verification_sessions", [
        ["type", "document"], ["return_url", `${siteUrl(env)}/referral.html?identity=return`], ["metadata[member_id]", auth.member.id],
        ["options[document][require_matching_selfie]", "true"]
      ], `identity-${auth.member.id}-${Date.now().toString().slice(0, -5)}`);
    } catch (error) {
      return json({ error: error.message === "STRIPE_NOT_CONFIGURED" ? "Stripe Identity is not configured." : "Stripe Identity could not start verification." }, 503, cors);
    }
    await env.DB.prepare(`UPDATE members SET stripe_identity_session_id=?,stripe_identity_status=?,identity_status='pending_identity',updated_at=? WHERE id=?`)
      .bind(session.id, session.status === "requires_input" ? "requires_input" : "processing", now(), auth.member.id).run();
    return json({ url: session.url, status: session.status }, 201, cors);
  }
  if (url.pathname === "/seller/activate" && request.method === "POST") {
    const auth = await requireMember(request, env, cors);
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 2000);
    const token = String(data.token || "");
    const row = token.length >= 24 ? await env.DB.prepare(`SELECT * FROM breaker_activation_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?`).bind(await digest(token, env.AUTH_SECRET), now()).first() : null;
    if (!row || normalizeEmail(row.target_email) !== normalizeEmail(auth.member.email) || (row.target_member_id && row.target_member_id !== auth.member.id)) return json({ error: "That seller activation link is invalid, expired, or belongs to another account." }, 403, cors);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO breaker_profiles(member_id,status,created_at,updated_at) VALUES(?,'active',?,?) ON CONFLICT(member_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`).bind(auth.member.id, now(), now()),
      env.DB.prepare(`UPDATE breaker_activation_codes SET used_at=?,used_by_member_id=?,target_member_id=? WHERE id=? AND used_at IS NULL`).bind(now(), auth.member.id, auth.member.id, row.id),
      env.DB.prepare(`UPDATE members SET active_portal='seller',updated_at=? WHERE id=?`).bind(now(), auth.member.id)
    ]);
    return json({ active: true, activePortal: "seller" }, 200, cors);
  }
  if (url.pathname === "/admin/sellers/activation" && request.method === "POST") {
    const auth = await requireOwner(request, env, cors);
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 2000);
    const email = normalizeEmail(data.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter the seller applicant email." }, 400, cors);
    const target = await env.DB.prepare(`SELECT id FROM members WHERE email=?`).bind(email).first();
    const token = randomToken();
    const activationId = uid();
    const expiresAt = new Date(Date.now() + 7 * 86400e3).toISOString();
    await env.DB.prepare(`INSERT INTO breaker_activation_codes(id,target_email,target_member_id,code_hash,created_by_member_id,expires_at,note,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(activationId, email, target?.id || null, await digest(token, env.AUTH_SECRET), auth.member.id, expiresAt, clean(data.note, 300), now()).run();
    return json({ activationUrl: `${siteUrl(env)}/referral.html?seller_activation=${encodeURIComponent(token)}`, expiresAt, oneTimeUse: true }, 201, cors);
  }
  if (url.pathname === "/admin/identity-reviews" && request.method === "GET") {
    const auth = await requireOwner(request, env, cors);
    if (auth.error) return auth.error;
    const rows = await env.DB.prepare(`
      SELECT review.*,member.email,member.live_username,member.first_name,member.last_name,member.birth_date,
             conflict.email conflicting_email,conflict.live_username conflicting_username
      FROM identity_review_queue review JOIN members member ON member.id=review.member_id
      LEFT JOIN members conflict ON conflict.id=review.conflicting_member_id
      WHERE review.status='pending' ORDER BY review.created_at ASC LIMIT 100
    `).all();
    return json({ reviews: rows.results || [] }, 200, cors);
  }
  const reviewMatch = url.pathname.match(/^\/admin\/identity-reviews\/([0-9a-f-]{36})$/i);
  if (reviewMatch && request.method === "POST") {
    const auth = await requireOwner(request, env, cors);
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1200);
    const decision = data.decision === "approve" ? "approved" : data.decision === "reject" ? "rejected" : "";
    if (!decision) return json({ error: "Choose approve or reject." }, 400, cors);
    const review = await env.DB.prepare(`SELECT * FROM identity_review_queue WHERE id=? AND status='pending'`).bind(reviewMatch[1]).first();
    if (!review) return json({ error: "That identity review is no longer pending." }, 404, cors);
    await env.DB.batch([
      env.DB.prepare(`UPDATE identity_review_queue SET status=?,reviewed_by_member_id=?,reviewed_at=? WHERE id=? AND status='pending'`).bind(decision, auth.member.id, now(), review.id),
      decision === "approved"
        ? env.DB.prepare(`UPDATE members SET identity_status='verified',stripe_identity_status='verified',referral_qualified_at=COALESCE(referral_qualified_at,?),updated_at=? WHERE id=?`).bind(now(), now(), review.member_id)
        : env.DB.prepare(`UPDATE members SET identity_status='rejected',stripe_identity_status='failed',updated_at=? WHERE id=?`).bind(now(), review.member_id)
    ]);
    return json({ ok: true, decision }, 200, cors);
  }
  const labelMatch = url.pathname.match(/^\/admin\/orders\/([0-9a-f-]{36})\/label$/i);
  if (labelMatch && request.method === "POST") return purchaseOrderLabel(request, env, cors, labelMatch[1]);
  if (url.pathname === "/live/auction" && request.method === "GET") return currentAuction(request, env, cors, url);
  if (url.pathname === "/live/viewers/heartbeat" && request.method === "POST") return viewerHeartbeat(request, env, cors);
  if (url.pathname === "/live/shows" && request.method === "GET") return listShows(request, env, cors);
  if (url.pathname === "/live/watchlist" && request.method === "POST") return updateWatchOrFollow(request, env, cors, "watch");
  if (url.pathname === "/live/follow" && request.method === "POST") return updateWatchOrFollow(request, env, cors, "follow");
  if (url.pathname === "/gifted-giveaways/catalog" && request.method === "GET") return giftCatalog(request, env, cors, url);
  if (url.pathname === "/seller/giveaways" && ["GET", "POST"].includes(request.method)) return sellerGiveaways(request, env, cors);
  if (url.pathname === "/seller/inventory" && ["GET", "POST"].includes(request.method)) return sellerInventory(request, env, cors);
  const sellerInventoryAdjustMatch = url.pathname.match(/^\/seller\/inventory\/([0-9a-f-]{36})\/adjust$/i);
  if (sellerInventoryAdjustMatch && request.method === "POST") return adjustSellerInventory(request, env, cors, sellerInventoryAdjustMatch[1]);
  if (url.pathname === "/seller/stream/input" && ["GET", "POST"].includes(request.method)) return sellerStreamInput(request, env, cors);
  if (url.pathname === "/seller/shows" && ["GET", "POST"].includes(request.method)) return sellerShows(request, env, cors);
  const sellerLotMatch = url.pathname.match(/^\/seller\/shows\/([0-9a-f-]{36})\/lots$/i);
  if (sellerLotMatch && request.method === "GET") return sellerShowLots(request, env, cors, sellerLotMatch[1]);
  if (sellerLotMatch && request.method === "POST") return createAuctionLot(request, env, cors, sellerLotMatch[1]);
  const sellerShowEndMatch = url.pathname.match(/^\/seller\/shows\/([0-9a-f-]{36})\/end$/i);
  if (sellerShowEndMatch && request.method === "POST") return endSellerShow(request, env, cors, sellerShowEndMatch[1]);
  const sellerLotActionMatch = url.pathname.match(/^\/seller\/lots\/([0-9a-f-]{36})\/(open|close)$/i);
  if (sellerLotActionMatch && request.method === "POST") return changeAuctionStatus(request, env, cors, sellerLotActionMatch[1], sellerLotActionMatch[2]);
  const bidMatch = url.pathname.match(/^\/live\/auction\/lots\/([0-9a-f-]{36})\/bid$/i);
  if (bidMatch && request.method === "POST") return placeBid(request, env, cors, bidMatch[1]);
  if (url.pathname === "/verify-order/sale" && request.method === "GET") return verifySale(request, env, cors, url);
  if (url.pathname === "/admin/reorders" && request.method === "GET") return adminReorders(request, env, cors);
  const adminReorderMatch = url.pathname.match(/^\/admin\/reorders\/([0-9a-f-]{36})$/i);
  if (adminReorderMatch && request.method === "POST") return adminReorders(request, env, cors, adminReorderMatch[1]);
  return null;
}

export { usernameKey };
