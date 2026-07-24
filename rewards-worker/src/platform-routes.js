import { stripeGet, stripeRequest, verifyStripeWebhook } from "./stripe-commerce.js";
import {
  DEFAULT_CONFIG as STREAM_DEFAULT_CONFIG,
  DEFAULT_PLANS as STREAM_DEFAULT_PLANS,
  calculateActualCredits,
  calculateProjection,
  estimateDashboard,
  nextAlertThreshold,
  normalizeConfig,
  normalizePlans,
  round2
} from "./stream-credits.js";

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
const monthKeyAt = (iso = now()) => String(iso).slice(0, 7);
const dateOnly = iso => String(iso || "").slice(0, 10);
const parseJsonSafe = (value, fallback) => {
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
};
const money = cents => Math.max(0, Number(cents || 0));
const crackPacksBidFloorCents = ({ landedCents = 0, packagingCents = 0, overheadCents = 0, fixedFeeCents = 30, margin = 0, feeRate = 0.029 } = {}) => {
  const base = money(landedCents) + money(packagingCents) + money(overheadCents) + money(fixedFeeCents);
  const denominator = 1 - Number(feeRate || 0) - Number(margin || 0);
  return denominator > 0 ? Math.ceil(base / denominator) : base;
};

async function latestStreamCreditConfig(env) {
  const row = await env.DB.prepare(`SELECT * FROM stream_credit_config_versions ORDER BY effective_at DESC, created_at DESC LIMIT 1`).first();
  if (!row) return { row: null, config: normalizeConfig(STREAM_DEFAULT_CONFIG) };
  const config = normalizeConfig({
    deliveryMinutesPerCredit: row.delivery_minutes_per_credit,
    storageMinutesPerCredit: row.storage_minutes_per_credit,
    replayReservePercentage: row.replay_reserve_percentage,
    safetyBufferPercentage: row.safety_buffer_percentage,
    recordingRetentionDays: row.recording_retention_days,
    monthDays: row.month_days,
    streamCreditUnderlyingValue: row.stream_credit_underlying_value,
    prepaidExtraCreditPrice: row.prepaid_extra_credit_price,
    paygOveragePrice: row.payg_overage_price,
    unusedCreditRebateRate: row.unused_credit_rebate_rate,
    finalizationDelayHours: row.finalization_delay_hours,
    protectedEvidenceReserveCredits: row.protected_evidence_reserve_credits,
    autoRefillPackageSizes: JSON.parse(row.auto_refill_package_sizes_json || "[10,25,50,100]"),
    spendingLimitDefault: row.spending_limit_default,
    cashOutThreshold: row.cash_out_threshold,
    prepaidCreditExpirationMonths: row.prepaid_credit_expiration_months,
    stripeDomesticRate: row.stripe_domestic_rate,
    stripeDomesticFixedFee: row.stripe_domestic_fixed_fee,
    cloudflareCreditCostAssumption: row.cloudflare_credit_cost_assumption
  });
  return { row, config };
}

async function latestStreamCreditPlans(env) {
  const rows = await env.DB.prepare(`
    SELECT pv.* FROM stream_credit_plan_versions pv
    JOIN (
      SELECT plan_code, MAX(effective_at || '|' || created_at) latest_marker
      FROM stream_credit_plan_versions GROUP BY plan_code
    ) latest ON latest.plan_code = pv.plan_code AND (pv.effective_at || '|' || pv.created_at) = latest.latest_marker
    ORDER BY pv.sort_order ASC
  `).all();
  if (!(rows.results || []).length) return normalizePlans(STREAM_DEFAULT_PLANS);
  return normalizePlans((rows.results || []).map(row => ({
    code: row.plan_code,
    name: row.plan_name,
    monthlyPrice: row.monthly_price,
    includedCredits: row.included_credits,
    sortOrder: row.sort_order,
    isPublic: Number(row.is_public || 0) === 1
  })));
}

async function seedStreamCreditDefaults(env, memberId = null) {
  const existingConfig = await env.DB.prepare(`SELECT id FROM stream_credit_config_versions LIMIT 1`).first();
  const existingPlans = await env.DB.prepare(`SELECT id FROM stream_credit_plan_versions LIMIT 1`).first();
  const stamp = now();
  const statements = [];
  if (!existingConfig) {
    statements.push(env.DB.prepare(`
      INSERT INTO stream_credit_config_versions(
        id,effective_at,created_at,created_by_member_id,delivery_minutes_per_credit,storage_minutes_per_credit,replay_reserve_percentage,safety_buffer_percentage,
        recording_retention_days,month_days,stream_credit_underlying_value,prepaid_extra_credit_price,payg_overage_price,unused_credit_rebate_rate,
        finalization_delay_hours,protected_evidence_reserve_credits,auto_refill_package_sizes_json,spending_limit_default,cash_out_threshold,
        prepaid_credit_expiration_months,stripe_domestic_rate,stripe_domestic_fixed_fee,cloudflare_credit_cost_assumption,notes
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      uid(), stamp, stamp, memberId,
      STREAM_DEFAULT_CONFIG.deliveryMinutesPerCredit, STREAM_DEFAULT_CONFIG.storageMinutesPerCredit, STREAM_DEFAULT_CONFIG.replayReservePercentage,
      STREAM_DEFAULT_CONFIG.safetyBufferPercentage, STREAM_DEFAULT_CONFIG.recordingRetentionDays, STREAM_DEFAULT_CONFIG.monthDays,
      STREAM_DEFAULT_CONFIG.streamCreditUnderlyingValue, STREAM_DEFAULT_CONFIG.prepaidExtraCreditPrice, STREAM_DEFAULT_CONFIG.paygOveragePrice,
      STREAM_DEFAULT_CONFIG.unusedCreditRebateRate, STREAM_DEFAULT_CONFIG.finalizationDelayHours, STREAM_DEFAULT_CONFIG.protectedEvidenceReserveCredits,
      JSON.stringify(STREAM_DEFAULT_CONFIG.autoRefillPackageSizes), STREAM_DEFAULT_CONFIG.spendingLimitDefault, STREAM_DEFAULT_CONFIG.cashOutThreshold,
      STREAM_DEFAULT_CONFIG.prepaidCreditExpirationMonths, STREAM_DEFAULT_CONFIG.stripeDomesticRate, STREAM_DEFAULT_CONFIG.stripeDomesticFixedFee,
      STREAM_DEFAULT_CONFIG.cloudflareCreditCostAssumption, "Initial default configuration"
    ));
  }
  if (!existingPlans) {
    STREAM_DEFAULT_PLANS.forEach(plan => {
      statements.push(env.DB.prepare(`
        INSERT INTO stream_credit_plan_versions(id,plan_code,plan_name,monthly_price,included_credits,sort_order,is_public,effective_at,created_at,created_by_member_id,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).bind(uid(), plan.code, plan.name, plan.monthlyPrice, plan.includedCredits, plan.sortOrder, plan.isPublic ? 1 : 0, stamp, stamp, memberId, "Initial default plan set"));
    });
  }
  if (statements.length) await env.DB.batch(statements);
}

function streamConfigResponse(row, config) {
  return {
    id: row?.id || null,
    effectiveAt: row?.effective_at || null,
    createdAt: row?.created_at || null,
    deliveryMinutesPerCredit: config.deliveryMinutesPerCredit,
    storageMinutesPerCredit: config.storageMinutesPerCredit,
    replayReservePercentage: config.replayReservePercentage,
    safetyBufferPercentage: config.safetyBufferPercentage,
    recordingRetentionDays: config.recordingRetentionDays,
    monthDays: config.monthDays,
    streamCreditUnderlyingValue: config.streamCreditUnderlyingValue,
    prepaidExtraCreditPrice: config.prepaidExtraCreditPrice,
    paygOveragePrice: config.paygOveragePrice,
    unusedCreditRebateRate: config.unusedCreditRebateRate,
    finalizationDelayHours: config.finalizationDelayHours,
    protectedEvidenceReserveCredits: config.protectedEvidenceReserveCredits,
    autoRefillPackageSizes: config.autoRefillPackageSizes,
    spendingLimitDefault: config.spendingLimitDefault,
    cashOutThreshold: config.cashOutThreshold,
    prepaidCreditExpirationMonths: config.prepaidCreditExpirationMonths,
    stripeDomesticRate: config.stripeDomesticRate,
    stripeDomesticFixedFee: config.stripeDomesticFixedFee,
    cloudflareCreditCostAssumption: config.cloudflareCreditCostAssumption
  };
}

async function streamCreditCalculator(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 4000);
  const { row, config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  const projection = calculateProjection(data, config, plans);
  return json({
    config: streamConfigResponse(row, projection.config),
    plans: projection.plans,
    metrics: projection.metrics,
    recommendedPlan: projection.recommendedPlan,
    lowerTierComparison: projection.lowerTierComparison,
    comparison: projection.comparison,
    enterpriseRequired: projection.enterpriseRequired
  }, 200, cors);
}

async function streamCreditDashboard(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const { row, config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  const subscription = await env.DB.prepare(`SELECT * FROM seller_stream_subscriptions WHERE member_id=?`).bind(auth.member.id).first();
  const monthKey = monthKeyAt();
  const usage = await env.DB.prepare(`SELECT * FROM seller_stream_usage_snapshots WHERE member_id=? AND month_key=?`).bind(auth.member.id, monthKey).first();
  const projection = calculateProjection(subscription || {}, config, plans);
  const dashboard = estimateDashboard(subscription || {}, usage || {}, config, plans);
  const ledgerRows = await env.DB.prepare(`
    SELECT credit_source,status,SUM(credit_quantity) quantity,SUM(dollar_value) dollar_value
    FROM seller_stream_credit_ledger WHERE member_id=? GROUP BY credit_source,status ORDER BY created_at DESC
  `).bind(auth.member.id).all();
  const threshold = nextAlertThreshold(dashboard.utilization);
  return json({
    config: streamConfigResponse(row, config),
    subscription: subscription ? {
      selectedPlanCode: subscription.selected_plan_code,
      selectedPlanName: subscription.selected_plan_name,
      monthlyPrice: subscription.monthly_price,
      includedCredits: subscription.included_credits,
      averageConcurrentViewers: subscription.average_concurrent_viewers,
      hoursPerShow: subscription.hours_per_show,
      showsPerMonth: subscription.shows_per_month,
      recordingRetentionDays: subscription.recording_retention_days,
      replayReservePercentage: subscription.replay_reserve_percentage,
      safetyBufferPercentage: subscription.safety_buffer_percentage,
      prepaidCreditsBalance: subscription.prepaid_credits_balance,
      pendingRebateBalance: subscription.pending_rebate_balance,
      cashOutEligibleBalance: subscription.cash_out_eligible_balance,
      autoRefillEnabled: Boolean(subscription.auto_refill_enabled),
      paygEnabled: Boolean(subscription.payg_enabled),
      stripeSubscriptionStatus: subscription.stripe_subscription_status || "",
      stripeCurrentPeriodEnd: subscription.stripe_current_period_end || null
    } : null,
    usage: usage ? {
      monthKey: usage.month_key,
      actualLiveViewerMinutes: round2(usage.actual_live_viewer_minutes),
      actualReplayMinutes: round2(usage.actual_replay_minutes),
      actualBuyerVideoMinutes: round2(usage.actual_buyer_video_minutes),
      actualProtectedEvidenceMinutes: round2(usage.actual_protected_evidence_minutes),
      actualDeliveredMinutes: round2(usage.actual_delivered_minutes),
      actualRecordedMinutes: round2(usage.actual_recorded_minutes),
      actualStoredMinutes: round2(usage.actual_stored_minutes),
      finalizedCreditsUsed: round2(usage.finalized_credits_used),
      projectedExhaustionAt: usage.projected_exhaustion_at,
      finalizationDueAt: usage.finalization_due_at,
      finalizedAt: usage.finalized_at
    } : null,
    dashboard,
    projection: { metrics: projection.metrics, recommendedPlan: projection.recommendedPlan, lowerTierComparison: projection.lowerTierComparison, comparison: projection.comparison },
    ledger: ledgerRows.results || [],
    nextAlertThreshold: threshold
  }, 200, cors);
}

async function ensureStripeCustomerForMember(env, member) {
  if (member.stripe_customer_id) return member.stripe_customer_id;
  const customer = await stripeRequest(env.STRIPE_SECRET_KEY, "/customers", [
    ["email", member.email],
    ["name", clean(`${member.first_name || ""} ${member.last_name || ""}`, 120) || clean(member.live_username || member.email, 120)],
    ["metadata[member_id]", member.id]
  ], `seller-customer-${member.id}`);
  await env.DB.prepare(`UPDATE members SET stripe_customer_id=?,updated_at=? WHERE id=?`).bind(customer.id, now(), member.id).run();
  member.stripe_customer_id = customer.id;
  return customer.id;
}

async function saveStreamCreditSubscription(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 5000);
  const { row, config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  const projection = calculateProjection(data, config, plans);
  const selectedPlanCode = String(data.selectedPlanCode || projection.recommendedPlan?.code || "starter").toLowerCase();
  const selectedPlan = projection.plans.find(plan => plan.code === selectedPlanCode) || projection.recommendedPlan || projection.plans[0];
  if (!selectedPlan) return json({ error: "No active seller plans are configured." }, 503, cors);
  await persistStreamCreditSubscription(env, auth.member.id, data, projection, selectedPlan, row?.id || null, config.spendingLimitDefault);
  return json({ ok: true, selectedPlan, metrics: projection.metrics, recommendedPlan: projection.recommendedPlan }, 200, cors);
}

async function persistStreamCreditSubscription(env, memberId, data, projection, selectedPlan, configVersionId, spendingLimitDefault) {
  const stamp = now();
  await env.DB.prepare(`
    INSERT INTO seller_stream_subscriptions(
      member_id,selected_plan_code,selected_plan_name,monthly_price,included_credits,average_concurrent_viewers,hours_per_show,shows_per_month,
      recording_retention_days,replay_reserve_percentage,safety_buffer_percentage,expected_orders_per_show,expected_growth_percentage,desired_safety_buffer_percentage,
      auto_refill_enabled,auto_refill_package_size,auto_refill_trigger_balance,auto_refill_monthly_spending_limit,auto_refill_max_refills,payg_enabled,payg_monthly_spending_limit,
      current_config_version_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET
      selected_plan_code=excluded.selected_plan_code,
      selected_plan_name=excluded.selected_plan_name,
      monthly_price=excluded.monthly_price,
      included_credits=excluded.included_credits,
      average_concurrent_viewers=excluded.average_concurrent_viewers,
      hours_per_show=excluded.hours_per_show,
      shows_per_month=excluded.shows_per_month,
      recording_retention_days=excluded.recording_retention_days,
      replay_reserve_percentage=excluded.replay_reserve_percentage,
      safety_buffer_percentage=excluded.safety_buffer_percentage,
      expected_orders_per_show=excluded.expected_orders_per_show,
      expected_growth_percentage=excluded.expected_growth_percentage,
      desired_safety_buffer_percentage=excluded.desired_safety_buffer_percentage,
      auto_refill_enabled=excluded.auto_refill_enabled,
      auto_refill_package_size=excluded.auto_refill_package_size,
      auto_refill_trigger_balance=excluded.auto_refill_trigger_balance,
      auto_refill_monthly_spending_limit=excluded.auto_refill_monthly_spending_limit,
      auto_refill_max_refills=excluded.auto_refill_max_refills,
      payg_enabled=excluded.payg_enabled,
      payg_monthly_spending_limit=excluded.payg_monthly_spending_limit,
      current_config_version_id=excluded.current_config_version_id,
      updated_at=excluded.updated_at
  `).bind(
    memberId, selectedPlan.code, selectedPlan.name, selectedPlan.monthlyPrice, selectedPlan.includedCredits,
    projection.inputs.averageConcurrentViewers, projection.inputs.hoursPerShow, projection.inputs.showsPerMonth,
    projection.inputs.recordingRetentionDays, projection.inputs.replayReservePercentage, projection.inputs.safetyBufferPercentage,
    Number(data.expectedOrdersPerShow || 0) || null, Number(data.expectedGrowthPercentage || 0) || null, Number(data.desiredSafetyBufferPercentage || 0) || null,
    data.autoRefillEnabled ? 1 : 0, Number(data.autoRefillPackageSize || 0) || null, Number(data.autoRefillTriggerBalance || 0) || null,
    Number(data.autoRefillMonthlySpendingLimit || 0) || null, Number(data.autoRefillMaxRefills || 0) || null,
    data.paygEnabled === false ? 0 : 1, Number(data.paygMonthlySpendingLimit || spendingLimitDefault) || spendingLimitDefault,
    configVersionId, stamp, stamp
  ).run();
}

async function saveStreamCreditUsage(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 5000);
  const { config } = await latestStreamCreditConfig(env);
  const monthKey = /^\d{4}-\d{2}$/.test(String(data.monthKey || "")) ? String(data.monthKey) : monthKeyAt();
  const live = Number(data.actualLiveViewerMinutes || 0);
  const replay = Number(data.actualReplayMinutes || 0);
  const buyer = Number(data.actualBuyerVideoMinutes || 0);
  const protectedEvidence = Number(data.actualProtectedEvidenceMinutes || 0);
  const delivered = round2(live + replay + buyer + protectedEvidence);
  const recorded = Number(data.actualRecordedMinutes || 0);
  const stored = Number(data.actualStoredMinutes || 0);
  const finalizedCreditsUsed = calculateActualCredits({ actualDeliveredMinutes: delivered, actualStoredMinutes: stored }, config);
  const finalizationDueAt = new Date(Date.now() + config.finalizationDelayHours * 3600e3).toISOString();
  const stamp = now();
  await env.DB.prepare(`
    INSERT INTO seller_stream_usage_snapshots(
      id,member_id,month_key,actual_live_viewer_minutes,actual_replay_minutes,actual_buyer_video_minutes,actual_protected_evidence_minutes,
      actual_delivered_minutes,actual_recorded_minutes,actual_stored_minutes,finalized_credits_used,finalization_due_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(member_id,month_key) DO UPDATE SET
      actual_live_viewer_minutes=excluded.actual_live_viewer_minutes,
      actual_replay_minutes=excluded.actual_replay_minutes,
      actual_buyer_video_minutes=excluded.actual_buyer_video_minutes,
      actual_protected_evidence_minutes=excluded.actual_protected_evidence_minutes,
      actual_delivered_minutes=excluded.actual_delivered_minutes,
      actual_recorded_minutes=excluded.actual_recorded_minutes,
      actual_stored_minutes=excluded.actual_stored_minutes,
      finalized_credits_used=excluded.finalized_credits_used,
      finalization_due_at=excluded.finalization_due_at,
      updated_at=excluded.updated_at
  `).bind(uid(), auth.member.id, monthKey, live, replay, buyer, protectedEvidence, delivered, recorded, stored, finalizedCreditsUsed, finalizationDueAt, stamp, stamp).run();
  await env.DB.prepare(`
    INSERT INTO seller_stream_credit_ledger(
      id,member_id,transaction_id,credit_source,credit_quantity,dollar_value,usage_category,status,created_at,usage_at,finalization_at,administrator_adjustment_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(uid(), auth.member.id, `usage-${monthKey}-${stamp}`, "monthly_included", finalizedCreditsUsed * -1, finalizedCreditsUsed * config.streamCreditUnderlyingValue * -1, "stream_usage", "pending_finalization", stamp, stamp, finalizationDueAt, "Seller usage snapshot").run();
  return json({ ok: true, monthKey, finalizedCreditsUsed, finalizationDueAt }, 200, cors);
}

async function startStreamPlanCheckout(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 5000);
  const { config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  const selectedPlanCode = String(data.selectedPlanCode || "").toLowerCase();
  const plan = plans.find(entry => entry.code === selectedPlanCode && Number.isFinite(entry.monthlyPrice));
  if (!plan) return json({ error: "Choose a paid seller plan." }, 400, cors);
  const customerId = await ensureStripeCustomerForMember(env, auth.member);
  const sessionId = uid();
  const expiresAt = new Date(Date.now() + 30 * 60e3).toISOString();
  const session = await stripeRequest(env.STRIPE_SECRET_KEY, "/checkout/sessions", [
    ["mode", "subscription"],
    ["customer", customerId],
    ["success_url", `${siteUrl(env)}/referral.html?streamPlan=success`],
    ["cancel_url", `${siteUrl(env)}/referral.html?streamPlan=cancelled`],
    ["line_items[0][price_data][currency]", "usd"],
    ["line_items[0][price_data][product_data][name]", `Crack Packs ${plan.name} seller plan`],
    ["line_items[0][price_data][product_data][description]", `${Number(plan.includedCredits || 0).toFixed(2)} monthly Stream Credits included`],
    ["line_items[0][price_data][unit_amount]", Math.round(Number(plan.monthlyPrice) * 100)],
    ["line_items[0][price_data][recurring][interval]", "month"],
    ["line_items[0][quantity]", 1],
    ["metadata[kind]", "stream_plan_subscription"],
    ["metadata[member_id]", auth.member.id],
    ["metadata[selected_plan_code]", plan.code],
    ["metadata[selected_plan_name]", plan.name],
    ["metadata[included_credits]", Number(plan.includedCredits || 0)],
    ["metadata[monthly_price]", Number(plan.monthlyPrice || 0)]
  ], `stream-plan-${auth.member.id}-${plan.code}-${Date.now()}`);
  await env.DB.prepare(`
    INSERT INTO seller_stream_checkout_sessions(id,member_id,kind,stripe_checkout_session_id,stripe_customer_id,selected_plan_code,selected_plan_name,total_amount,currency,status,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'open',?,?,?)
  `).bind(sessionId, auth.member.id, "subscription", session.id, customerId, plan.code, plan.name, Number(plan.monthlyPrice || 0), "USD", expiresAt, now(), now()).run();
  const projection = calculateProjection(data, config, plans);
  await persistStreamCreditSubscription(env, auth.member.id, { ...data, selectedPlanCode: plan.code }, projection, plan, null, config.spendingLimitDefault);
  return json({ checkoutUrl: session.url, sessionId: session.id, plan, config: streamConfigResponse(null, config) }, 201, cors);
}

async function startStreamCreditPurchase(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 2000);
  const quantity = Math.max(1, Math.min(10000, Number(data.creditQuantity || 0)));
  if (!Number.isFinite(quantity) || quantity <= 0) return json({ error: "Choose how many prepaid credits to buy." }, 400, cors);
  const { config } = await latestStreamCreditConfig(env);
  const customerId = await ensureStripeCustomerForMember(env, auth.member);
  const totalAmount = round2(quantity * config.prepaidExtraCreditPrice);
  const sessionId = uid();
  const expiresAt = new Date(Date.now() + 30 * 60e3).toISOString();
  const session = await stripeRequest(env.STRIPE_SECRET_KEY, "/checkout/sessions", [
    ["mode", "payment"],
    ["customer", customerId],
    ["success_url", `${siteUrl(env)}/referral.html?streamCredits=success`],
    ["cancel_url", `${siteUrl(env)}/referral.html?streamCredits=cancelled`],
    ["line_items[0][price_data][currency]", "usd"],
    ["line_items[0][price_data][product_data][name]", `Crack Packs prepaid Stream Credits (${quantity})`],
    ["line_items[0][price_data][product_data][description]", `Prepaid rollover credits at $${config.prepaidExtraCreditPrice.toFixed(2)} per credit`],
    ["line_items[0][price_data][unit_amount]", Math.round(config.prepaidExtraCreditPrice * 100)],
    ["line_items[0][quantity]", Math.round(quantity)],
    ["metadata[kind]", "stream_credit_purchase"],
    ["metadata[member_id]", auth.member.id],
    ["metadata[credit_quantity]", quantity],
    ["metadata[unit_price]", config.prepaidExtraCreditPrice]
  ], `stream-credit-${auth.member.id}-${Date.now()}`);
  await env.DB.prepare(`
    INSERT INTO seller_stream_checkout_sessions(id,member_id,kind,stripe_checkout_session_id,stripe_customer_id,credit_quantity,total_amount,currency,status,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'open',?,?,?)
  `).bind(sessionId, auth.member.id, "prepaid_credits", session.id, customerId, quantity, totalAmount, "USD", expiresAt, now(), now()).run();
  return json({ checkoutUrl: session.url, sessionId: session.id, creditQuantity: quantity, totalAmount }, 201, cors);
}

async function getStreamCreditConfig(request, env, cors) {
  const auth = await requireOwner(request, env, cors);
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const { row, config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  return json({ config: streamConfigResponse(row, config), plans }, 200, cors);
}

async function saveStreamCreditConfig(request, env, cors) {
  const auth = await requireOwner(request, env, cors);
  if (auth.error) return auth.error;
  await seedStreamCreditDefaults(env, auth.member.id);
  const data = await boundedJson(request, 12000);
  const config = normalizeConfig(data.config || {});
  const plans = normalizePlans(Array.isArray(data.plans) && data.plans.length ? data.plans : STREAM_DEFAULT_PLANS);
  const effectiveAt = Number.isFinite(Date.parse(data.effectiveAt)) ? new Date(data.effectiveAt).toISOString() : now();
  const stamp = now();
  const statements = [
    env.DB.prepare(`
      INSERT INTO stream_credit_config_versions(
        id,effective_at,created_at,created_by_member_id,delivery_minutes_per_credit,storage_minutes_per_credit,replay_reserve_percentage,safety_buffer_percentage,
        recording_retention_days,month_days,stream_credit_underlying_value,prepaid_extra_credit_price,payg_overage_price,unused_credit_rebate_rate,finalization_delay_hours,
        protected_evidence_reserve_credits,auto_refill_package_sizes_json,spending_limit_default,cash_out_threshold,prepaid_credit_expiration_months,stripe_domestic_rate,
        stripe_domestic_fixed_fee,cloudflare_credit_cost_assumption,notes
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      uid(), effectiveAt, stamp, auth.member.id, config.deliveryMinutesPerCredit, config.storageMinutesPerCredit, config.replayReservePercentage,
      config.safetyBufferPercentage, config.recordingRetentionDays, config.monthDays, config.streamCreditUnderlyingValue, config.prepaidExtraCreditPrice,
      config.paygOveragePrice, config.unusedCreditRebateRate, config.finalizationDelayHours, config.protectedEvidenceReserveCredits,
      JSON.stringify(config.autoRefillPackageSizes), config.spendingLimitDefault, config.cashOutThreshold, config.prepaidCreditExpirationMonths,
      config.stripeDomesticRate, config.stripeDomesticFixedFee, config.cloudflareCreditCostAssumption, clean(data.notes, 300)
    )
  ];
  plans.forEach(plan => {
    statements.push(env.DB.prepare(`
      INSERT INTO stream_credit_plan_versions(id,plan_code,plan_name,monthly_price,included_credits,sort_order,is_public,effective_at,created_at,created_by_member_id,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(uid(), plan.code, plan.name, plan.monthlyPrice, plan.includedCredits, plan.sortOrder, plan.isPublic ? 1 : 0, effectiveAt, stamp, auth.member.id, clean(data.notes, 300)));
  });
  await env.DB.batch(statements);
  return json({ ok: true, effectiveAt }, 201, cors);
}

async function runStreamCreditCycleRoute(request, env, cors) {
  const auth = await requireOwner(request, env, cors);
  if (auth.error) return auth.error;
  const result = await runStreamCreditCycle(env, { notify: true });
  return json({ ok: true, ...result, ranAt: now() }, 200, cors);
}

async function sendOrderEmail(env, to, subject, html, key) {
  if (!env.RESEND_API_KEY || !to) return;
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ from: "Crack Packs Orders <orders@crackpacks.com>", to: [to], subject, html })
  });
  if (!result.ok) console.error("Order email failed", { status: result.status });
}
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
async function sendTransactionalEmail(env, to, subject, html, key) {
  if (!to) return;
  if (env.RESEND_API_KEY) {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ from: "Crack Packs Rewards <rewards@crackpacks.com>", to: [to], subject, html })
    });
    if (!result.ok) console.error("Transactional email failed", { status: result.status, subject });
    return;
  }
  if (!env.REWARDS_EMAIL) return;
  const message = new EmailMessage("rewards@crackpacks.com", to, `From: Crack Packs Rewards <rewards@crackpacks.com>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`);
  await env.REWARDS_EMAIL.send(message);
}
async function sendSellerGrantedEmail(env, member, liveUsername) {
  const referralUrl = `${siteUrl(env)}/referral.html?ref=${encodeURIComponent(member.invite_code || "")}`;
  const accountUrl = `${siteUrl(env)}/referral.html`;
  const html = `<div style="font-family:Arial,sans-serif;color:#111827"><h1 style="color:#151936">Seller account granted</h1><p>Thank you for signing up.</p><p><strong>Your Crack Packs User ID:</strong> ${escapeHtml(liveUsername)}</p><p><strong>Your refer-a-friend URL:</strong><br><a href="${escapeHtml(referralUrl)}">${escapeHtml(referralUrl)}</a></p><p>Please follow or check out our socials for frequent codes to redeem on your account.</p><p>If you earn 100 sign-ups, you get a ticket to our annual Raffle Bonanza. Each ticket is a winner.</p><p><a href="${escapeHtml(accountUrl)}" style="display:inline-block;padding:14px 22px;background:#f8ff46;color:#070815;text-decoration:none;font-weight:bold;border-radius:10px">Go to account</a></p></div>`;
  await sendTransactionalEmail(env, member.email, "Crack Packs seller account granted", html, `seller-granted-${member.id}`);
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

async function grantIncludedMonthlyCredits(env, memberId, subscription, config) {
  const monthKey = monthKeyAt();
  const transactionId = `monthly-${memberId}-${monthKey}`;
  const existing = await env.DB.prepare(`SELECT id FROM seller_stream_credit_ledger WHERE member_id=? AND transaction_id=?`).bind(memberId, transactionId).first();
  if (existing) return;
  const credits = Number(subscription.included_credits || 0);
  if (!(credits > 0)) return;
  await env.DB.prepare(`
    INSERT INTO seller_stream_credit_ledger(
      id,member_id,transaction_id,subscription_id,credit_source,credit_quantity,dollar_value,usage_category,status,created_at,expiration_at,administrator_adjustment_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(uid(), memberId, transactionId, subscription.stripe_subscription_id || "", "monthly_included", credits, round2(credits * config.streamCreditUnderlyingValue), "monthly_plan", "available", now(), `${monthKey}-31T23:59:59.999Z`, "Monthly included credits").run();
}

async function completeStreamPlanSubscription(env, session) {
  const memberId = String(session.metadata?.member_id || "");
  if (!validUuid(memberId)) return;
  const selectedPlanCode = String(session.metadata?.selected_plan_code || "").toLowerCase();
  const selectedPlanName = clean(session.metadata?.selected_plan_name || "Seller plan", 60);
  const includedCredits = Number(session.metadata?.included_credits || 0);
  const monthlyPrice = Number(session.metadata?.monthly_price || 0);
  const customerId = String(session.customer || "");
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || "";
  const subscription = subscriptionId ? await stripeGet(env.STRIPE_SECRET_KEY, `/subscriptions/${encodeURIComponent(subscriptionId)}`) : null;
  const { config } = await latestStreamCreditConfig(env);
  await env.DB.batch([
    env.DB.prepare(`UPDATE seller_stream_checkout_sessions SET status='paid',updated_at=? WHERE stripe_checkout_session_id=?`).bind(now(), session.id),
    env.DB.prepare(`
      UPDATE seller_stream_subscriptions
      SET selected_plan_code=?,selected_plan_name=?,monthly_price=?,included_credits=?,stripe_subscription_id=?,stripe_subscription_status=?,stripe_current_period_end=?,stripe_last_invoice_id=?,updated_at=?
      WHERE member_id=?
    `).bind(
      selectedPlanCode, selectedPlanName, monthlyPrice, includedCredits, subscriptionId, clean(subscription?.status || "active", 40),
      subscription?.current_period_end ? new Date(Number(subscription.current_period_end) * 1000).toISOString() : null,
      clean(typeof subscription?.latest_invoice === "string" ? subscription.latest_invoice : subscription?.latest_invoice?.id || "", 80),
      now(), memberId
    ),
    env.DB.prepare(`UPDATE members SET stripe_customer_id=COALESCE(NULLIF(?,''),stripe_customer_id),updated_at=? WHERE id=?`).bind(customerId, now(), memberId)
  ]);
  const saved = await env.DB.prepare(`SELECT * FROM seller_stream_subscriptions WHERE member_id=?`).bind(memberId).first();
  if (saved) await grantIncludedMonthlyCredits(env, memberId, saved, config);
}

async function completeStreamCreditPurchase(env, session) {
  const memberId = String(session.metadata?.member_id || "");
  if (!validUuid(memberId)) return;
  const creditQuantity = Number(session.metadata?.credit_quantity || 0);
  if (!(creditQuantity > 0)) return;
  const { config } = await latestStreamCreditConfig(env);
  const checkout = await env.DB.prepare(`SELECT * FROM seller_stream_checkout_sessions WHERE stripe_checkout_session_id=? AND kind='prepaid_credits'`).bind(session.id).first();
  if (!checkout || checkout.status === "paid") return;
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE seller_stream_checkout_sessions SET status='paid',updated_at=? WHERE id=?`).bind(stamp, checkout.id),
    env.DB.prepare(`UPDATE seller_stream_subscriptions SET prepaid_credits_balance=prepaid_credits_balance+?,updated_at=? WHERE member_id=?`).bind(creditQuantity, stamp, memberId),
    env.DB.prepare(`
      INSERT INTO seller_stream_credit_ledger(
        id,member_id,transaction_id,credit_source,credit_quantity,dollar_value,usage_category,status,created_at,expiration_at,administrator_adjustment_reason
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(uid(), memberId, `prepaid-${session.id}`, "prepaid_rollover", creditQuantity, round2(creditQuantity * config.streamCreditUnderlyingValue), "credit_purchase", "available", stamp, new Date(Date.now() + config.prepaidCreditExpirationMonths * 30 * 86400e3).toISOString(), "Prepaid credit purchase")
  ]);
}

async function sendStreamCreditEmail(env, to, subject, html, key) {
  if (!env.RESEND_API_KEY || !to) return;
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ from: "Crack Packs Alerts <alerts@crackpacks.com>", to: [to], subject, html })
  });
  if (!result.ok) console.error("Stream credit email failed", { status: result.status });
}

async function runStreamCreditCycle(env, { notify = true } = {}) {
  await seedStreamCreditDefaults(env);
  const sync = await syncStreamUsageFromCloudflare(env).catch(error => {
    console.error("Cloudflare Stream usage sync failed", error);
    return { syncedMembers: 0, syncedVideos: 0, syncFailed: true };
  });
  const { config } = await latestStreamCreditConfig(env);
  const plans = await latestStreamCreditPlans(env);
  const stamp = now();
  const finalizable = await env.DB.prepare(`
    SELECT usage.*,subscription.included_credits,subscription.member_id
    FROM seller_stream_usage_snapshots usage
    JOIN seller_stream_subscriptions subscription ON subscription.member_id=usage.member_id
    WHERE usage.finalized_at IS NULL AND usage.finalization_due_at IS NOT NULL AND usage.finalization_due_at<=?
  `).bind(stamp).all();
  for (const usage of finalizable.results || []) {
    const rebateCredits = round2(Math.max(0, Number(usage.included_credits || 0) - Number(usage.finalized_credits_used || 0)));
    const rebateValue = round2(rebateCredits * config.unusedCreditRebateRate);
    await env.DB.batch([
      env.DB.prepare(`UPDATE seller_stream_usage_snapshots SET finalized_at=?,updated_at=? WHERE id=?`).bind(stamp, stamp, usage.id),
      env.DB.prepare(`UPDATE seller_stream_credit_ledger SET status='consumed',finalization_at=? WHERE member_id=? AND status='pending_finalization' AND transaction_id LIKE ?`).bind(stamp, usage.member_id, `usage-${usage.month_key}-%`)
    ]);
    if (rebateValue > 0) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE seller_stream_subscriptions SET pending_rebate_balance=pending_rebate_balance+?,cash_out_eligible_balance=cash_out_eligible_balance+?,updated_at=? WHERE member_id=?`).bind(rebateValue, rebateValue, stamp, usage.member_id),
        env.DB.prepare(`
          INSERT INTO seller_stream_credit_ledger(
            id,member_id,transaction_id,credit_source,credit_quantity,dollar_value,usage_category,status,created_at,rebate_at,administrator_adjustment_reason
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        `).bind(uid(), usage.member_id, `rebate-${usage.month_key}`, "rebate", rebateCredits, rebateValue, "unused_credit_rebate", "rebated", stamp, stamp, "Unused monthly credits rebated after finalization")
      ]);
    }
  }

  const subscriptions = await env.DB.prepare(`
    SELECT subscription.*,member.email,member.first_name,member.live_username,usage.*
    FROM seller_stream_subscriptions subscription
    JOIN members member ON member.id=subscription.member_id
    LEFT JOIN seller_stream_usage_snapshots usage ON usage.member_id=subscription.member_id AND usage.month_key=?
  `).bind(monthKeyAt()).all();
  let alertsSent = 0;
  for (const row of subscriptions.results || []) {
    const dashboard = estimateDashboard(row, row, config, plans);
    for (const threshold of [50, 75, 90, 100]) {
      if (dashboard.utilization < threshold) continue;
      const prior = await env.DB.prepare(`SELECT id FROM seller_stream_credit_alerts WHERE member_id=? AND month_key=? AND threshold_percent=? AND channel='email'`).bind(row.member_id, monthKeyAt(), threshold).first();
      if (prior) continue;
      const detail = JSON.stringify({
        currentUsage: dashboard.actualCreditsUsed,
        remainingCredits: dashboard.creditsRemaining,
        projectedMonthlyUsage: dashboard.projectedEndOfMonthUsage,
        projectedOverage: dashboard.projectedOverage
      });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO seller_stream_credit_alerts(id,member_id,month_key,threshold_percent,sent_at,channel,detail) VALUES(?,?,?,?,?,'dashboard',?)`).bind(uid(), row.member_id, monthKeyAt(), threshold, stamp, detail),
        env.DB.prepare(`INSERT INTO seller_stream_credit_alerts(id,member_id,month_key,threshold_percent,sent_at,channel,detail) VALUES(?,?,?,?,?,'email',?)`).bind(uid(), row.member_id, monthKeyAt(), threshold, stamp, detail)
      ]);
      alertsSent += 1;
      if (notify) {
        const name = clean(row.first_name || row.live_username || "seller", 60);
        await sendStreamCreditEmail(
          env,
          row.email,
          `Crack Packs Stream Credits: ${threshold}% used`,
          `<h1>Stream Credits alert</h1><p>Hi ${name},</p><p>You have used ${dashboard.utilization.toFixed(2)}% of your included Stream Credits for ${monthKeyAt()}.</p><p>Remaining credits: ${dashboard.creditsRemaining.toFixed(2)}</p><p>Projected monthly usage: ${dashboard.projectedEndOfMonthUsage.toFixed(2)}</p><p>Projected overage: ${dashboard.projectedOverage.toFixed(2)}</p><p>Open your seller dashboard to upgrade, buy prepaid credits, or enable auto-refill.</p>`,
          `stream-alert-${row.member_id}-${monthKeyAt()}-${threshold}`
        );
      }
    }
  }
  return { finalizedUsageCount: (finalizable.results || []).length, alertsSent, syncedMembers: sync.syncedMembers || 0, syncedVideos: sync.syncedVideos || 0, syncFailed: Boolean(sync.syncFailed) };
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
      if (session.metadata?.kind === "stream_plan_subscription") await completeStreamPlanSubscription(env, session);
      if (session.metadata?.kind === "stream_credit_purchase") await completeStreamCreditPurchase(env, session);
    }
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await expireSession(env, event.data?.object || {});
  } else if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data?.object || {};
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : "";
    if (subscriptionId) {
      const subscription = await env.DB.prepare(`SELECT * FROM seller_stream_subscriptions WHERE stripe_subscription_id=?`).bind(subscriptionId).first();
      if (subscription) {
        const { config } = await latestStreamCreditConfig(env);
        await env.DB.prepare(`UPDATE seller_stream_subscriptions SET stripe_subscription_status='active',stripe_last_invoice_id=?,updated_at=? WHERE member_id=?`)
          .bind(clean(invoice.id || "", 80), now(), subscription.member_id).run();
        await grantIncludedMonthlyCredits(env, subscription.member_id, subscription, config);
      }
    }
  } else if (event.type === "invoice.payment_failed") {
    const invoice = event.data?.object || {};
    const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : "";
    if (subscriptionId) {
      await env.DB.prepare(`UPDATE seller_stream_subscriptions SET stripe_subscription_status='past_due',stripe_last_invoice_id=?,updated_at=? WHERE stripe_subscription_id=?`)
        .bind(clean(invoice.id || "", 80), now(), subscriptionId).run();
    }
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

async function sellerCogsOrders(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare(`
    SELECT orders.id order_id,orders.order_number,orders.status,orders.payment_status,orders.placed_at,
      orders.subtotal_cents,orders.shipping_cents,orders.tax_cents,orders.total_cents,orders.currency,orders.items_json,
      reservation.inventory_item_id,reservation.quantity reservation_quantity,reservation.unit_amount_cents,reservation.shipping_amount_cents,
      inventory.name inventory_name,inventory.sku inventory_sku,inventory.cogs_cents,inventory.packaging_cents,inventory.overhead_cents,
      inventory.live_list_price_cents,inventory.website_list_price_cents,inventory.us_shipping_cents,
      breaker.id breaker_inventory_item_id,breaker.product_name breaker_product_name,breaker.sku breaker_sku,breaker.unit_type,breaker.packs_per_unit,
      breaker.quantity current_quantity,breaker.inbound_quantity
    FROM member_orders orders
    LEFT JOIN checkout_reservations reservation ON reservation.order_id=orders.id
    LEFT JOIN inventory_items inventory ON inventory.id=reservation.inventory_item_id
    LEFT JOIN breaker_inventory_items breaker ON breaker.member_id=orders.member_id
      AND breaker.source_inventory_item_id=reservation.inventory_item_id
      AND breaker.unit_type='sealed_box'
    WHERE orders.member_id=? AND orders.channel='website' AND orders.payment_status='paid'
    ORDER BY orders.placed_at DESC, orders.created_at DESC
    LIMIT 100
  `).bind(auth.member.id).all();
  const orders = (rows.results || []).map(row => {
    const orderedUnits = Math.max(1, Number(row.reservation_quantity || 0) || Number(parseJsonSafe(row.items_json, [])[0]?.quantity || 1));
    const subtotalCents = money(row.subtotal_cents || Number(row.unit_amount_cents || 0) * orderedUnits);
    const shippingCents = money(row.shipping_cents || row.shipping_amount_cents);
    const taxCents = money(row.tax_cents);
    const totalCents = money(row.total_cents || subtotalCents + shippingCents + taxCents);
    const catalogCogsCents = row.cogs_cents == null ? null : money(row.cogs_cents) * orderedUnits;
    const landedCents = totalCents || subtotalCents + shippingCents + taxCents;
    const perUnitCents = Math.ceil(landedCents / orderedUnits);
    const packsPerUnit = Number(row.packs_per_unit || 0);
    const perPackCents = packsPerUnit > 0 ? Math.ceil(perUnitCents / packsPerUnit) : null;
    const suggestedMinimumBidCents = crackPacksBidFloorCents({
      landedCents: perUnitCents,
      packagingCents: row.packaging_cents,
      overheadCents: row.overhead_cents
    });
    return {
      orderId: row.order_id,
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      placedAt: row.placed_at,
      productName: row.breaker_product_name || row.inventory_name || parseJsonSafe(row.items_json, [])[0]?.name || "Seller Store order",
      sku: row.breaker_sku || row.inventory_sku || "",
      unitType: row.unit_type || "sealed_box",
      orderedUnits,
      currentQuantity: Number(row.current_quantity || 0),
      inboundQuantity: Number(row.inbound_quantity || 0),
      packsPerUnit: packsPerUnit || null,
      subtotalCents,
      shippingCents,
      taxCents,
      totalCents,
      catalogCogsCents,
      landedCents,
      perUnitCents,
      perPackCents,
      suggestedMinimumBidCents,
      sourceLiveListPriceCents: row.live_list_price_cents == null ? null : money(row.live_list_price_cents),
      sourceWebsiteListPriceCents: row.website_list_price_cents == null ? null : money(row.website_list_price_cents),
      currency: row.currency || "USD"
    };
  });
  return json({ orders }, 200, cors);
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

function storeListingView(row) {
  const linkedShow = row.show_id ? {
    showId: row.show_id,
    showTitle: row.show_title || "Crack Packs show",
    showStatus: row.show_status || "open",
    publicSlug: row.show_public_slug || "",
    scheduledAt: row.show_scheduled_at || row.show_started_at || "",
    livePageUrl: row.show_id ? `${siteUrl({ SITE_URL: row.__site_url || "" })}/live.html?show=${encodeURIComponent(row.show_id)}` : "",
    lotId: row.matched_lot_id || "",
    lotTitle: row.matched_lot_title || "",
    lotStatus: row.matched_lot_status || "",
    startingBidCents: row.matched_lot_starting_bid_cents == null ? null : Number(row.matched_lot_starting_bid_cents),
    currentBidCents: row.matched_lot_current_bid_cents == null ? null : Number(row.matched_lot_current_bid_cents),
    startingBidInRange: row.matched_lot_starting_bid_cents == null
      ? false
      : (Number(row.matched_lot_starting_bid_cents) > 0 && Number(row.matched_lot_starting_bid_cents) <= Number(row.price_cents || 0)),
    hasScheduledInventory: ["scheduled", "live"].includes(String(row.matched_lot_status || ""))
  } : null;
  return {
    id: row.id,
    sellerId: row.member_id,
    sellerUsername: row.live_username || clean(`${row.first_name || ""} ${row.last_name || ""}`, 120) || "Seller",
    showId: row.show_id || "",
    linkedLotId: row.linked_lot_id || "",
    series: row.inventory_series || "pokemon",
    title: row.title || "Store listing",
    description: row.description || "",
    saleType: row.sale_type || "sealed",
    condition: row.item_condition || "",
    quantity: Number(row.quantity || 0),
    priceCents: Number(row.price_cents || 0),
    shippingPayer: row.shipping_payer || "buyer",
    imageUrl: row.image_url || "",
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    liveShow: linkedShow
  };
}

async function publicMarketplaceListings(request, env, cors) {
  const url = new URL(request.url);
  const series = ["pokemon", "magic"].includes(String(url.searchParams.get("series") || "").toLowerCase())
    ? String(url.searchParams.get("series") || "").toLowerCase()
    : "";
  const rows = await env.DB.prepare(`
    SELECT listing.*,member.live_username,member.first_name,member.last_name,inventory.series inventory_series,
           session.title show_title,session.status show_status,session.public_slug show_public_slug,session.scheduled_at show_scheduled_at,session.started_at show_started_at,
           (
             SELECT lot.id FROM breaker_auction_lots lot
             WHERE lot.session_id=listing.show_id
               AND lot.member_id=listing.member_id
               AND (
                 (listing.linked_lot_id IS NOT NULL AND listing.linked_lot_id<>'' AND lot.id=listing.linked_lot_id)
                 OR
                 ((listing.linked_lot_id IS NULL OR listing.linked_lot_id='') AND lower(trim(lot.title))=lower(trim(listing.title)))
               )
               AND lot.status IN ('scheduled','live','sold')
             ORDER BY CASE lot.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lot.updated_at DESC
             LIMIT 1
           ) matched_lot_id,
           (
             SELECT lot.title FROM breaker_auction_lots lot
             WHERE lot.session_id=listing.show_id
               AND lot.member_id=listing.member_id
               AND (
                 (listing.linked_lot_id IS NOT NULL AND listing.linked_lot_id<>'' AND lot.id=listing.linked_lot_id)
                 OR
                 ((listing.linked_lot_id IS NULL OR listing.linked_lot_id='') AND lower(trim(lot.title))=lower(trim(listing.title)))
               )
               AND lot.status IN ('scheduled','live','sold')
             ORDER BY CASE lot.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lot.updated_at DESC
             LIMIT 1
           ) matched_lot_title,
           (
             SELECT lot.status FROM breaker_auction_lots lot
             WHERE lot.session_id=listing.show_id
               AND lot.member_id=listing.member_id
               AND (
                 (listing.linked_lot_id IS NOT NULL AND listing.linked_lot_id<>'' AND lot.id=listing.linked_lot_id)
                 OR
                 ((listing.linked_lot_id IS NULL OR listing.linked_lot_id='') AND lower(trim(lot.title))=lower(trim(listing.title)))
               )
               AND lot.status IN ('scheduled','live','sold')
             ORDER BY CASE lot.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lot.updated_at DESC
             LIMIT 1
           ) matched_lot_status,
           (
             SELECT lot.starting_bid_cents FROM breaker_auction_lots lot
             WHERE lot.session_id=listing.show_id
               AND lot.member_id=listing.member_id
               AND (
                 (listing.linked_lot_id IS NOT NULL AND listing.linked_lot_id<>'' AND lot.id=listing.linked_lot_id)
                 OR
                 ((listing.linked_lot_id IS NULL OR listing.linked_lot_id='') AND lower(trim(lot.title))=lower(trim(listing.title)))
               )
               AND lot.status IN ('scheduled','live','sold')
             ORDER BY CASE lot.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lot.updated_at DESC
             LIMIT 1
           ) matched_lot_starting_bid_cents,
           (
             SELECT lot.current_bid_cents FROM breaker_auction_lots lot
             WHERE lot.session_id=listing.show_id
               AND lot.member_id=listing.member_id
               AND (
                 (listing.linked_lot_id IS NOT NULL AND listing.linked_lot_id<>'' AND lot.id=listing.linked_lot_id)
                 OR
                 ((listing.linked_lot_id IS NULL OR listing.linked_lot_id='') AND lower(trim(lot.title))=lower(trim(listing.title)))
               )
               AND lot.status IN ('scheduled','live','sold')
             ORDER BY CASE lot.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, lot.updated_at DESC
             LIMIT 1
           ) matched_lot_current_bid_cents,
           ? __site_url
    FROM seller_store_listings listing
    JOIN members member ON member.id=listing.member_id
    LEFT JOIN inventory_items inventory ON inventory.id=listing.inventory_item_id
    LEFT JOIN breaker_stream_sessions session ON session.id=listing.show_id
    WHERE listing.status='active' AND listing.quantity>0
      AND (?='' OR lower(COALESCE(inventory.series,''))=?)
    ORDER BY listing.updated_at DESC, listing.created_at DESC
    LIMIT 500
  `).bind(siteUrl(env), series, series).all();
  return json({
    ok: true,
    items: (rows.results || []).map(storeListingView),
    series: series || "all"
  }, 200, cors);
}

async function sellerStoreListings(request, env, cors, listingId = "") {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT listing.*,member.live_username,member.first_name,member.last_name,lot.title linked_lot_title,lot.status linked_lot_status
      FROM seller_store_listings listing
      JOIN members member ON member.id=listing.member_id
      LEFT JOIN breaker_auction_lots lot ON lot.id=listing.linked_lot_id
      WHERE listing.member_id=?
      ORDER BY listing.updated_at DESC, listing.created_at DESC
      LIMIT 250
    `).bind(auth.member.id).all();
    return json({ items: (rows.results || []).map(storeListingView) }, 200, cors);
  }
  const data = await boundedJson(request, 6000);
  if (request.method === "POST" && listingId) {
    const status = ["active", "inactive", "sold_out"].includes(String(data.status || "")) ? String(data.status) : "";
    if (!status) return json({ error: "Choose a valid listing status." }, 400, cors);
    const listing = await env.DB.prepare(`SELECT * FROM seller_store_listings WHERE id=? AND member_id=?`).bind(listingId, auth.member.id).first();
    if (!listing) return json({ error: "Store listing not found." }, 404, cors);
    await env.DB.prepare(`UPDATE seller_store_listings SET status=?,updated_at=? WHERE id=? AND member_id=?`).bind(status, now(), listing.id, auth.member.id).run();
    const updated = await env.DB.prepare(`
      SELECT listing.*,member.live_username,member.first_name,member.last_name
      FROM seller_store_listings listing JOIN members member ON member.id=listing.member_id
      WHERE listing.id=?
    `).bind(listing.id).first();
    return json({ item: storeListingView(updated) }, 200, cors);
  }
  const title = clean(data.title, 120);
  const description = clean(data.description, 1000);
  const condition = clean(data.condition, 80);
  const saleType = ["cards", "breaks", "singles", "sealed", "rip_ship", "rtyh", "buy_ship"].includes(data.saleType) ? data.saleType : "sealed";
  const quantity = Number(data.quantity || 0);
  const price = Math.round(Number(data.price || 0) * 100);
  const shippingPayer = ["buyer", "seller"].includes(String(data.shippingPayer || "")) ? String(data.shippingPayer) : "buyer";
  const imageUrl = clean(data.imageUrl, 500);
  const showId = clean(data.showId, 80);
  const linkedLotId = clean(data.linkedLotId, 80);
  if (!title || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !Number.isInteger(price) || price < 1 || price > 100000000) {
    return json({ error: "Enter a title, quantity, and store price." }, 400, cors);
  }
  if (imageUrl && !/^https:\/\//i.test(imageUrl) && !/^assets\/images\/[a-z0-9._/-]+$/i.test(imageUrl)) {
    return json({ error: "Listing image must use HTTPS or a local assets/images path." }, 400, cors);
  }
  if (linkedLotId) {
    const linkedLot = await env.DB.prepare(`
      SELECT lot.id,lot.session_id
      FROM breaker_auction_lots lot
      WHERE lot.id=? AND lot.member_id=?
    `).bind(linkedLotId, auth.member.id).first();
    if (!linkedLot) return json({ error: "Selected auction lot was not found for this seller account." }, 404, cors);
    if (showId && linkedLot.session_id !== showId) return json({ error: "Selected auction lot does not belong to the chosen show." }, 409, cors);
  }
  let inventoryItemId = clean(data.inventoryItemId, 80);
  let inventorySeries = "";
  if (inventoryItemId) {
    const inventory = await env.DB.prepare(`SELECT id,series FROM inventory_items WHERE id=?`).bind(inventoryItemId).first();
    if (!inventory) return json({ error: "Selected inventory item was not found." }, 404, cors);
    inventoryItemId = inventory.id;
    inventorySeries = inventory.series || "";
  }
  const listingRowId = uid();
  const stamp = now();
  await env.DB.prepare(`
    INSERT INTO seller_store_listings(
      id,member_id,show_id,linked_lot_id,inventory_item_id,title,description,sale_type,item_condition,quantity,price_cents,shipping_payer,image_url,status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)
  `).bind(listingRowId, auth.member.id, showId || null, linkedLotId || null, inventoryItemId || null, title, description, saleType, condition, quantity, price, shippingPayer, imageUrl, stamp, stamp).run();
  const created = await env.DB.prepare(`
    SELECT listing.*,member.live_username,member.first_name,member.last_name,? inventory_series,lot.title linked_lot_title,lot.status linked_lot_status
    FROM seller_store_listings listing JOIN members member ON member.id=listing.member_id
    LEFT JOIN breaker_auction_lots lot ON lot.id=listing.linked_lot_id
    WHERE listing.id=?
  `).bind(inventorySeries, listingRowId).first();
  return json({ item: storeListingView(created) }, 201, cors);
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
  if (!response.ok || payload.success === false) {
    const providerError = clean(payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || payload?.result?.message || "", 240);
    throw new Error(providerError ? `STREAM_PROVIDER_ERROR:${providerError}` : "STREAM_PROVIDER_ERROR");
  }
  return payload.result || payload;
}

async function cloudflareGraphqlRequest(env, query, variables) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_API_TOKEN) throw new Error("STREAM_NOT_CONFIGURED");
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) throw new Error("STREAM_ANALYTICS_PROVIDER_ERROR");
  return payload.data;
}

async function setLiveInputEnabled(env, liveInputUid, enabled) {
  if (!liveInputUid) return;
  await cloudflareRequest(env, `/live_inputs/${encodeURIComponent(liveInputUid)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled: Boolean(enabled) })
  });
}

function chooseBestRecordingForSession(session, videos) {
  const startedMs = Date.parse(session.started_at || "");
  const endedMs = Date.parse(session.ended_at || session.updated_at || session.started_at || "");
  const maxAheadMs = 6 * 3600e3;
  const candidates = (videos || []).filter(video => {
    const createdMs = Date.parse(video.created || video.readyToStreamAt || "");
    if (!Number.isFinite(createdMs)) return false;
    if (!Number.isFinite(startedMs)) return true;
    return createdMs >= startedMs - 15 * 60e3 && createdMs <= endedMs + maxAheadMs;
  });
  const ranked = candidates.sort((left, right) => {
    const leftMs = Date.parse(left.created || left.readyToStreamAt || "");
    const rightMs = Date.parse(right.created || right.readyToStreamAt || "");
    return Math.abs(leftMs - startedMs) - Math.abs(rightMs - startedMs);
  });
  return ranked[0] || null;
}

async function listLiveInputVideos(env, liveInputUid) {
  const result = await cloudflareRequest(env, `/live_inputs/${encodeURIComponent(liveInputUid)}/videos`, { method: "GET" });
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.result)) return result.result;
  return [];
}

async function getLiveInputLifecycle(env, liveInputUid) {
  const customer = String(env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!customer) throw new Error("STREAM_CUSTOMER_CODE_MISSING");
  const host = customer.includes(".") ? customer : `${customer}.cloudflarestream.com`;
  const response = await fetch(`https://${host}/${encodeURIComponent(liveInputUid)}/lifecycle`);
  if (!response.ok) throw new Error("STREAM_LIFECYCLE_PROVIDER_ERROR");
  return response.json();
}

async function fetchDeliveredMinutesByVideo(env, videoUid, startDate, endDate) {
  const data = await cloudflareGraphqlRequest(env, `
    query CrackPacksStreamMinutes($accountTag: string!, $start: Date!, $end: Date!, $uid: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          streamMinutesViewedAdaptiveGroups(
            filter: { date_geq: $start, date_lt: $end, uid: $uid }
            limit: 100
          ) {
            sum { minutesViewed }
            dimensions { uid }
          }
        }
      }
    }
  `, { accountTag: env.CLOUDFLARE_ACCOUNT_ID, start: startDate, end: endDate, uid: videoUid });
  const groups = data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups || [];
  return round2(groups.reduce((sum, row) => sum + Number(row?.sum?.minutesViewed || 0), 0));
}

async function syncStreamUsageFromCloudflare(env, { memberId = "", showId = "" } = {}) {
  await seedStreamCreditDefaults(env);
  const { config } = await latestStreamCreditConfig(env);
  const currentMonth = monthKeyAt();
  const monthStart = `${currentMonth}-01`;
  const nextMonthDate = new Date(`${currentMonth}-01T00:00:00.000Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const monthEnd = dateOnly(nextMonthDate.toISOString());
  const retentionCutoff = new Date(Date.now() - Number(config.recordingRetentionDays || 90) * 86400e3).toISOString();
  const sessionFilters = [`(session.started_at>=? OR session.updated_at>=?)`];
  const sessionParams = [retentionCutoff, retentionCutoff];
  if (memberId) {
    sessionFilters.push(`session.member_id=?`);
    sessionParams.push(memberId);
  }
  if (showId) {
    sessionFilters.push(`session.id=?`);
    sessionParams.push(showId);
  }
  const sessions = await env.DB.prepare(`
    SELECT session.*,member.live_username
    FROM breaker_stream_sessions session
    JOIN members member ON member.id=session.member_id
    WHERE ${sessionFilters.join(" AND ")}
    ORDER BY session.started_at DESC
  `).bind(...sessionParams).all();
  const byMember = new Map();
  for (const session of sessions.results || []) {
    let videoUid = String(session.cloudflare_recording_video_uid || "");
    let video = null;
    const liveInputUid = String(session.cloudflare_live_input_uid || "");
    try {
      if (!videoUid && liveInputUid) {
        const lifecycle = ["open", "live"].includes(session.status) ? await getLiveInputLifecycle(env, liveInputUid).catch(() => null) : null;
        if (lifecycle?.videoUID) videoUid = String(lifecycle.videoUID);
        const videos = await listLiveInputVideos(env, liveInputUid);
        video = videoUid ? videos.find(entry => String(entry.uid || "") === videoUid) || null : chooseBestRecordingForSession(session, videos);
        if (!videoUid && video?.uid) videoUid = String(video.uid);
      } else if (videoUid) {
        video = await cloudflareRequest(env, `/${encodeURIComponent(videoUid)}`, { method: "GET" }).catch(() => null);
      }
    } catch {}
    if (!videoUid && !video) continue;
    if (!video && videoUid) video = await cloudflareRequest(env, `/${encodeURIComponent(videoUid)}`, { method: "GET" }).catch(() => null);
    if (!video) continue;
    const createdAt = String(video.created || session.started_at || "");
    const readyAt = String(video.readyToStreamAt || video.readyToStreamAt || "");
    const durationSeconds = Number(video.duration || 0);
    const recordingMinutes = round2(durationSeconds > 0 ? durationSeconds / 60 : 0);
    const deliveredMinutes = await fetchDeliveredMinutesByVideo(env, String(video.uid || videoUid), monthStart, monthEnd).catch(() => 0);
    const stillStored = !video.scheduledDeletion || Date.parse(video.scheduledDeletion) > Date.now();
    const storedMinutes = stillStored ? recordingMinutes : 0;
    const usageMonthKey = monthKeyAt(createdAt || session.started_at || now());
    const payloadJson = JSON.stringify({
      uid: video.uid || videoUid,
      created: video.created || null,
      readyToStreamAt: video.readyToStreamAt || null,
      scheduledDeletion: video.scheduledDeletion || null,
      duration: video.duration || null,
      status: video.status || null
    });
    const stamp = now();
    await env.DB.prepare(`
      INSERT INTO seller_stream_video_sources(
        id,member_id,stream_session_id,month_key,cloudflare_live_input_uid,cloudflare_video_uid,video_created_at,video_ready_at,video_duration_seconds,delivered_minutes,stored_minutes,recording_minutes,analytics_window_start,analytics_window_end,raw_payload_json,last_synced_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(member_id,cloudflare_video_uid,month_key) DO UPDATE SET
        stream_session_id=excluded.stream_session_id,
        video_created_at=excluded.video_created_at,
        video_ready_at=excluded.video_ready_at,
        video_duration_seconds=excluded.video_duration_seconds,
        delivered_minutes=excluded.delivered_minutes,
        stored_minutes=excluded.stored_minutes,
        recording_minutes=excluded.recording_minutes,
        analytics_window_start=excluded.analytics_window_start,
        analytics_window_end=excluded.analytics_window_end,
        raw_payload_json=excluded.raw_payload_json,
        last_synced_at=excluded.last_synced_at,
        updated_at=excluded.updated_at
    `).bind(uid(), session.member_id, session.id, usageMonthKey, liveInputUid, String(video.uid || videoUid), createdAt || null, readyAt || null, durationSeconds, deliveredMinutes, storedMinutes, recordingMinutes, monthStart, monthEnd, payloadJson, stamp, stamp, stamp).run();
    if (videoUid && videoUid !== session.cloudflare_recording_video_uid) {
      await env.DB.prepare(`UPDATE breaker_stream_sessions SET cloudflare_recording_video_uid=?,status=CASE WHEN status='ended' THEN 'recording_ready' ELSE status END,updated_at=? WHERE id=?`)
        .bind(videoUid, stamp, session.id).run();
    }
    const bucket = byMember.get(session.member_id) || { delivered: 0, stored: 0, recording: 0, buyer: 0, protectedEvidence: 0, live: 0, sessions: 0 };
    bucket.delivered += deliveredMinutes;
    bucket.stored += storedMinutes;
    bucket.recording += recordingMinutes;
    bucket.sessions += 1;
    byMember.set(session.member_id, bucket);
  }
  for (const [memberId, totals] of byMember) {
    const finalizedCreditsUsed = calculateActualCredits({ actualDeliveredMinutes: totals.delivered, actualStoredMinutes: totals.stored }, config);
    const stamp = now();
    await env.DB.prepare(`
      INSERT INTO seller_stream_usage_snapshots(
        id,member_id,month_key,actual_live_viewer_minutes,actual_replay_minutes,actual_buyer_video_minutes,actual_protected_evidence_minutes,actual_delivered_minutes,actual_recorded_minutes,actual_stored_minutes,finalized_credits_used,source,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(member_id,month_key) DO UPDATE SET
        actual_live_viewer_minutes=excluded.actual_live_viewer_minutes,
        actual_replay_minutes=excluded.actual_replay_minutes,
        actual_buyer_video_minutes=excluded.actual_buyer_video_minutes,
        actual_protected_evidence_minutes=excluded.actual_protected_evidence_minutes,
        actual_delivered_minutes=excluded.actual_delivered_minutes,
        actual_recorded_minutes=excluded.actual_recorded_minutes,
        actual_stored_minutes=excluded.actual_stored_minutes,
        finalized_credits_used=excluded.finalized_credits_used,
        source='system',
        updated_at=excluded.updated_at
    `).bind(uid(), memberId, currentMonth, totals.delivered, 0, totals.buyer, totals.protectedEvidence, totals.delivered, totals.recording, totals.stored, finalizedCreditsUsed, "system", stamp, stamp).run();
  }
  return { syncedMembers: byMember.size, syncedVideos: [...byMember.values()].reduce((sum, row) => sum + row.sessions, 0) };
}

async function sellerStreamInput(request, env, cors) {
  const auth = await requireMember(request, env, cors, { seller: true });
  if (auth.error) return auth.error;
  let input = await env.DB.prepare(`SELECT * FROM breaker_stream_inputs WHERE member_id=?`).bind(auth.member.id).first();
  if ((request.method === "POST" && !input) || request.method === "PUT") {
    if (request.method === "PUT" && input?.cloudflare_live_input_uid) {
      await cloudflareRequest(env, `/live_inputs/${encodeURIComponent(input.cloudflare_live_input_uid)}`, { method: "DELETE" }).catch(() => null);
    }
    let created;
    try {
      created = await cloudflareRequest(env, "/live_inputs", { method: "POST", body: JSON.stringify({ meta: { name: `${auth.member.live_username || "seller"} Crack Packs input` }, recording: { mode: "automatic" }, enabled: false }) });
    } catch (error) {
      if (error.message === "STREAM_NOT_CONFIGURED") return json({ error: "Cloudflare Stream credentials are not configured." }, 503, cors);
      const providerDetail = String(error.message || "").startsWith("STREAM_PROVIDER_ERROR:") ? String(error.message).slice("STREAM_PROVIDER_ERROR:".length) : "";
      return json({ error: providerDetail ? `Cloudflare could not create the live input. ${providerDetail}` : "Cloudflare could not create the live input." }, 503, cors);
    }
    const stamp = now();
    const rtmps = created.rtmps || {};
    const srt = created.srt || {};
    await env.DB.prepare(`
      INSERT INTO breaker_stream_inputs(member_id,cloudflare_live_input_uid,rtmps_url,rtmps_stream_key,srt_url,srt_stream_id,srt_passphrase,status,created_by_member_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(member_id) DO UPDATE SET
        cloudflare_live_input_uid=excluded.cloudflare_live_input_uid,
        rtmps_url=excluded.rtmps_url,
        rtmps_stream_key=excluded.rtmps_stream_key,
        srt_url=excluded.srt_url,
        srt_stream_id=excluded.srt_stream_id,
        srt_passphrase=excluded.srt_passphrase,
        status='disabled',
        updated_at=excluded.updated_at
    `)
      .bind(auth.member.id, created.uid, clean(rtmps.url, 300), clean(rtmps.streamKey, 500), clean(srt.url, 500), clean(srt.streamId, 300), clean(srt.passphrase, 300), "disabled", auth.member.id, stamp, stamp).run();
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
  const input = await env.DB.prepare(`SELECT * FROM breaker_stream_inputs WHERE member_id=?`).bind(auth.member.id).first();
  if (!input) return json({ error: "Create your private OBS stream input first." }, 409, cors);
  const scheduledAt = data.scheduledAt && Number.isFinite(Date.parse(data.scheduledAt)) ? new Date(data.scheduledAt).toISOString() : null;
  const showId = uid(); const stamp = now();
  const slug = `${clean(auth.member.live_username || "seller", 32).toLowerCase()}-${showId.slice(0, 8)}`;
  await setLiveInputEnabled(env, input.cloudflare_live_input_uid, true).catch(() => null);
  await env.DB.prepare(`INSERT INTO breaker_stream_sessions(id,member_id,cloudflare_live_input_uid,title,status,started_at,created_at,updated_at,public_slug,scheduled_at,thumbnail_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(showId, auth.member.id, input.cloudflare_live_input_uid, title, "open", scheduledAt || stamp, stamp, stamp, slug, scheduledAt, clean(data.thumbnailUrl, 500)).run();
  await env.DB.prepare(`UPDATE breaker_stream_inputs SET status='enabled',updated_at=? WHERE member_id=?`).bind(stamp, auth.member.id).run();
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
  const remainingOpen = await env.DB.prepare(`SELECT id,cloudflare_live_input_uid FROM breaker_stream_sessions WHERE member_id=? AND id<>? AND status IN ('open','live') LIMIT 1`).bind(auth.member.id, showId).first();
  if (!remainingOpen) {
    const input = await env.DB.prepare(`SELECT cloudflare_live_input_uid FROM breaker_stream_inputs WHERE member_id=?`).bind(auth.member.id).first();
    if (input?.cloudflare_live_input_uid) await setLiveInputEnabled(env, input.cloudflare_live_input_uid, false).catch(() => null);
    await env.DB.prepare(`UPDATE breaker_stream_inputs SET status='disabled',updated_at=? WHERE member_id=?`).bind(stamp, auth.member.id).run();
  }
  const streamCreditSync = await syncStreamUsageFromCloudflare(env, { memberId: auth.member.id, showId }).catch(error => {
    console.error("Post-show Stream Credit sync failed", error);
    return { syncedMembers: 0, syncedVideos: 0, syncFailed: true };
  });
  return json({ ended: true, endedAt: stamp, streamCreditSync }, 200, cors);
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
  if (url.pathname === "/seller/stream-credits/calculate" && request.method === "POST") return streamCreditCalculator(request, env, cors);
  if (url.pathname === "/seller/stream-credits/dashboard" && request.method === "GET") return streamCreditDashboard(request, env, cors);
  if (url.pathname === "/seller/stream-credits/subscription" && request.method === "POST") return saveStreamCreditSubscription(request, env, cors);
  if (url.pathname === "/seller/stream-credits/usage" && request.method === "POST") return saveStreamCreditUsage(request, env, cors);
  if (url.pathname === "/seller/stream-credits/checkout-plan" && request.method === "POST") return startStreamPlanCheckout(request, env, cors);
  if (url.pathname === "/seller/stream-credits/checkout-credits" && request.method === "POST") return startStreamCreditPurchase(request, env, cors);
  if (url.pathname === "/admin/stream-credits/config" && request.method === "GET") return getStreamCreditConfig(request, env, cors);
  if (url.pathname === "/admin/stream-credits/config" && request.method === "POST") return saveStreamCreditConfig(request, env, cors);
  if (url.pathname === "/admin/stream-credits/run-cycle" && request.method === "POST") return runStreamCreditCycleRoute(request, env, cors);
  if (url.pathname === "/store/checkout" && request.method === "POST") return createStoreCheckout(request, env, cors);
  if (url.pathname === "/gifted-giveaways/checkout" && request.method === "POST") return createGiftCheckout(request, env, cors);
  if (url.pathname === "/profile/contact" && request.method === "POST") return saveBuyerContact(request, env, cors);
  if (url.pathname === "/billing/setup" && request.method === "POST") return startBillingSetup(request, env, cors);
  if (url.pathname === "/portal/status" && request.method === "GET") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    const profile = await sellerProfile(env, auth.member.id);
    const owner = normalizeEmail(auth.member.email) === normalizeEmail(env.ADMIN_EMAIL);
    const requestedPortal = String(auth.member.active_portal || "buyer");
    const activePortal = owner && requestedPortal === "master"
      ? "master"
      : ((owner || profile?.status === "active") && requestedPortal === "seller" ? "seller" : "buyer");
    return json({
      activePortal,
      sellerAccess: owner || profile?.status === "active",
      sellerStatus: owner ? "owner" : profile?.status || "not_applied",
      isMaster: owner,
      roles: owner ? ["buyer", "seller", "master"] : ((profile?.status === "active") ? ["buyer", "seller"] : ["buyer"])
    }, 200, cors);
  }
  if (url.pathname === "/portal/mode" && request.method === "POST") {
    const auth = await requireMember(request, env, cors);
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1000);
    const owner = normalizeEmail(auth.member.email) === normalizeEmail(env.ADMIN_EMAIL);
    const requestedMode = data.mode === "master" ? "master" : (data.mode === "seller" ? "seller" : "buyer");
    const mode = requestedMode === "master" ? "master" : (requestedMode === "seller" ? "seller" : "buyer");
    if (mode === "master" && !owner) return json({ error: "Master Portal access is restricted to the master account." }, 403, cors);
    if (mode === "seller" && !owner && (await sellerProfile(env, auth.member.id))?.status !== "active") return json({ error: "Seller Portal access has not been activated for this account." }, 403, cors);
    await env.DB.prepare(`UPDATE members SET active_portal=?,updated_at=? WHERE id=?`).bind(mode, now(), auth.member.id).run();
    return json({ activePortal: mode }, 200, cors);
  }
  if (url.pathname === "/profile/live-username/check" && request.method === "POST") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1000);
    const username = clean(data.liveUsername, 32);
    if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) return json({ error: "User ID must be 3-32 characters, start with a letter, and use only letters, numbers, or underscores." }, 400, cors);
    const key = usernameKey(username);
    if (key.length < 3) return json({ error: "Choose a more distinctive User ID." }, 400, cors);
    const rows = await env.DB.prepare(`SELECT id,live_username_key FROM members WHERE id<>? AND live_username_key IS NOT NULL`).bind(auth.member.id).all();
    const collision = (rows.results || []).find(row => row.live_username_key === key || row.live_username_key.startsWith(key) || key.startsWith(row.live_username_key));
    if (collision) return json({ error: "That User ID is already used or is too similar to an existing User ID." }, 409, cors);
    return json({ ok: true, available: true, liveUsername: username }, 200, cors);
  }
  if (url.pathname === "/profile/live-username" && request.method === "POST") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    const data = await boundedJson(request, 1000);
    const username = clean(data.liveUsername, 32);
    if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) return json({ error: "User ID must be 3-32 characters, start with a letter, and use only letters, numbers, or underscores." }, 400, cors);
    const key = usernameKey(username);
    if (key.length < 3) return json({ error: "Choose a more distinctive User ID." }, 400, cors);
    const rows = await env.DB.prepare(`SELECT id,live_username_key FROM members WHERE id<>? AND live_username_key IS NOT NULL`).bind(auth.member.id).all();
    const collision = (rows.results || []).find(row => row.live_username_key === key || row.live_username_key.startsWith(key) || key.startsWith(row.live_username_key));
    if (collision) return json({ error: "That User ID is already used or is too similar to an existing User ID." }, 409, cors);
    const activateSeller = data.activateSeller === true;
    if (activateSeller) {
      if (!auth.member.device_verified || auth.member.identity_status !== "verified") return json({ error: "Complete seller passkey and Stripe identity verification before activating seller access." }, 403, cors);
      if (!auth.member.first_name || !auth.member.last_name || !auth.member.birth_date) return json({ error: "Complete the seller legal profile before activating seller access." }, 403, cors);
    }
    const stamp = now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE members SET live_username=?,live_username_key=?,active_portal=?,updated_at=? WHERE id=?`).bind(username, key, activateSeller ? "seller" : (auth.member.active_portal || "buyer"), stamp, auth.member.id),
      ...(activateSeller ? [env.DB.prepare(`INSERT INTO breaker_profiles(member_id,status,created_at,updated_at) VALUES(?,'active',?,?) ON CONFLICT(member_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`).bind(auth.member.id, stamp, stamp)] : [])
    ]);
    if (activateSeller && !auth.member.live_username) {
      const updatedMember = await env.DB.prepare(`SELECT * FROM members WHERE id=?`).bind(auth.member.id).first();
      await sendSellerGrantedEmail(env, updatedMember, username);
    }
    return json({ liveUsername: username, sellerActivated: activateSeller, activePortal: activateSeller ? "seller" : (auth.member.active_portal || "buyer") }, 200, cors);
  }
  if (url.pathname === "/identity/session" && request.method === "POST") {
    const auth = await requireMember(request, env, cors, { verified: false });
    if (auth.error) return auth.error;
    if (!auth.member.device_verified || !auth.member.first_name || !auth.member.last_name || !auth.member.birth_date) return json({ error: "Complete your legal profile and passkey before Stripe Identity verification." }, 403, cors);
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
  if (url.pathname === "/seller/cogs-orders" && request.method === "GET") return sellerCogsOrders(request, env, cors);
  if (url.pathname === "/seller/store-listings" && ["GET", "POST"].includes(request.method)) return sellerStoreListings(request, env, cors);
  const sellerStoreListingMatch = url.pathname.match(/^\/seller\/store-listings\/([0-9a-f-]{36})\/status$/i);
  if (sellerStoreListingMatch && request.method === "POST") return sellerStoreListings(request, env, cors, sellerStoreListingMatch[1]);
  const sellerInventoryAdjustMatch = url.pathname.match(/^\/seller\/inventory\/([0-9a-f-]{36})\/adjust$/i);
  if (sellerInventoryAdjustMatch && request.method === "POST") return adjustSellerInventory(request, env, cors, sellerInventoryAdjustMatch[1]);
  if (url.pathname === "/marketplace/listings" && request.method === "GET") return publicMarketplaceListings(request, env, cors);
  if (url.pathname === "/seller/stream/input" && ["GET", "POST"].includes(request.method)) return sellerStreamInput(request, env, cors);
  if (url.pathname === "/seller/stream/input/regenerate" && request.method === "POST") return sellerStreamInput(new Request(request, { method: "PUT" }), env, cors);
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

export { chooseBestRecordingForSession, runStreamCreditCycle, usernameKey };
