const DAY_MINUTES = 1440;

const DEFAULT_CONFIG = Object.freeze({
  deliveryMinutesPerCredit: 1000,
  storageMinutesPerCredit: 200,
  replayReservePercentage: 0.10,
  safetyBufferPercentage: 0.20,
  recordingRetentionDays: 90,
  monthDays: 30,
  streamCreditUnderlyingValue: 1,
  prepaidExtraCreditPrice: 1.50,
  subscriberExtraCreditPrice: 1.25,
  paygOveragePrice: 1.25,
  unusedCreditRebateRate: 1,
  finalizationDelayHours: 72,
  protectedEvidenceReserveCredits: 5,
  autoRefillPackageSizes: [10, 25, 50, 100],
  spendingLimitDefault: 250,
  cashOutThreshold: 25,
  prepaidCreditExpirationMonths: 12,
  stripeDomesticRate: 0.029,
  stripeDomesticFixedFee: 0.30,
  cloudflareCreditCostAssumption: 1
});

const DEFAULT_PLANS = Object.freeze([
  { code: "starter", name: "Starter", monthlyPrice: 29, includedCredits: 25, sortOrder: 1, isPublic: true },
  { code: "growth", name: "Growth", monthlyPrice: 99, includedCredits: 75, sortOrder: 2, isPublic: true },
  { code: "pro", name: "Pro", monthlyPrice: 525, includedCredits: 425, sortOrder: 3, isPublic: true },
  { code: "power", name: "Power", monthlyPrice: 1999, includedCredits: 1600, sortOrder: 4, isPublic: true },
  { code: "enterprise", name: "Enterprise", monthlyPrice: null, includedCredits: null, sortOrder: 5, isPublic: true }
]);

const round2 = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const ceil2 = value => Math.ceil((Number(value || 0) - Number.EPSILON) * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...(input || {}) };
  config.deliveryMinutesPerCredit = Number(config.deliveryMinutesPerCredit || DEFAULT_CONFIG.deliveryMinutesPerCredit);
  config.storageMinutesPerCredit = Number(config.storageMinutesPerCredit || DEFAULT_CONFIG.storageMinutesPerCredit);
  config.replayReservePercentage = Number(config.replayReservePercentage ?? DEFAULT_CONFIG.replayReservePercentage);
  config.safetyBufferPercentage = Number(config.safetyBufferPercentage ?? DEFAULT_CONFIG.safetyBufferPercentage);
  config.recordingRetentionDays = Number(config.recordingRetentionDays || DEFAULT_CONFIG.recordingRetentionDays);
  config.monthDays = Number(config.monthDays || DEFAULT_CONFIG.monthDays);
  config.streamCreditUnderlyingValue = Number(config.streamCreditUnderlyingValue || DEFAULT_CONFIG.streamCreditUnderlyingValue);
  config.prepaidExtraCreditPrice = Number(config.prepaidExtraCreditPrice || DEFAULT_CONFIG.prepaidExtraCreditPrice);
  config.subscriberExtraCreditPrice = Number(config.subscriberExtraCreditPrice || DEFAULT_CONFIG.subscriberExtraCreditPrice);
  config.paygOveragePrice = Number(config.paygOveragePrice || DEFAULT_CONFIG.paygOveragePrice);
  config.unusedCreditRebateRate = Number(config.unusedCreditRebateRate || DEFAULT_CONFIG.unusedCreditRebateRate);
  config.finalizationDelayHours = Number(config.finalizationDelayHours || DEFAULT_CONFIG.finalizationDelayHours);
  config.protectedEvidenceReserveCredits = Number(config.protectedEvidenceReserveCredits || DEFAULT_CONFIG.protectedEvidenceReserveCredits);
  config.cashOutThreshold = Number(config.cashOutThreshold || DEFAULT_CONFIG.cashOutThreshold);
  config.spendingLimitDefault = Number(config.spendingLimitDefault || DEFAULT_CONFIG.spendingLimitDefault);
  config.prepaidCreditExpirationMonths = Number(config.prepaidCreditExpirationMonths || DEFAULT_CONFIG.prepaidCreditExpirationMonths);
  config.stripeDomesticRate = Number(config.stripeDomesticRate || DEFAULT_CONFIG.stripeDomesticRate);
  config.stripeDomesticFixedFee = Number(config.stripeDomesticFixedFee || DEFAULT_CONFIG.stripeDomesticFixedFee);
  config.cloudflareCreditCostAssumption = Number(config.cloudflareCreditCostAssumption || DEFAULT_CONFIG.cloudflareCreditCostAssumption);
  config.autoRefillPackageSizes = Array.isArray(config.autoRefillPackageSizes)
    ? config.autoRefillPackageSizes.map(Number).filter(value => Number.isFinite(value) && value > 0)
    : DEFAULT_CONFIG.autoRefillPackageSizes.slice();
  return config;
}

function normalizePlans(plans = DEFAULT_PLANS) {
  return [...plans].map(plan => ({
    code: String(plan.code || "").toLowerCase(),
    name: String(plan.name || "").trim(),
    monthlyPrice: plan.monthlyPrice === null || plan.monthlyPrice === undefined ? null : Number(plan.monthlyPrice),
    includedCredits: plan.includedCredits === null || plan.includedCredits === undefined ? null : Number(plan.includedCredits),
    sortOrder: Number(plan.sortOrder || 0),
    isPublic: plan.isPublic !== false
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

function calculateProjection(inputs = {}, rawConfig = DEFAULT_CONFIG, rawPlans = DEFAULT_PLANS) {
  const config = normalizeConfig(rawConfig);
  const plans = normalizePlans(rawPlans);
  const averageConcurrentViewers = clamp(Number(inputs.averageConcurrentViewers || 0), 0, 1000000);
  const hoursPerShow = clamp(Number(inputs.hoursPerShow || 0), 0, 744);
  const showsPerMonth = clamp(Number(inputs.showsPerMonth || 0), 0, 5000);
  const recordingRetentionDays = clamp(Number(inputs.recordingRetentionDays ?? config.recordingRetentionDays), 0, 3650);
  const replayReservePercentage = clamp(Number(inputs.replayReservePercentage ?? config.replayReservePercentage), 0, 10);
  const safetyBufferPercentage = clamp(Number(inputs.safetyBufferPercentage ?? config.safetyBufferPercentage), 0, 10);

  const liveViewerMinutes = averageConcurrentViewers * hoursPerShow * 60 * showsPerMonth;
  const replayReserveMinutes = liveViewerMinutes * replayReservePercentage;
  const projectedDeliveredMinutes = liveViewerMinutes + replayReserveMinutes;
  const monthlyRecordedMinutes = hoursPerShow * 60 * showsPerMonth;
  const retentionMonths = recordingRetentionDays / config.monthDays;
  const projectedStoredMinutes = monthlyRecordedMinutes * retentionMonths;
  const deliveryCredits = projectedDeliveredMinutes / config.deliveryMinutesPerCredit;
  const storageCredits = projectedStoredMinutes / config.storageMinutesPerCredit;
  const projectedBaseCredits = deliveryCredits + storageCredits;
  const recommendedCreditCapacity = projectedBaseCredits * (1 + safetyBufferPercentage);
  const roundedBaseCredits = round2(projectedBaseCredits);
  const roundedCapacity = ceil2(recommendedCreditCapacity);

  const publicPlans = plans.filter(plan => plan.isPublic);
  const eligiblePlans = publicPlans.filter(plan => Number.isFinite(plan.includedCredits));
  const recommendedPlan = eligiblePlans.find(plan => Number(plan.includedCredits) >= roundedCapacity) || publicPlans.find(plan => plan.code === "enterprise") || publicPlans.at(-1) || null;

  const comparison = eligiblePlans.map(plan => {
    const includedCredits = Number(plan.includedCredits || 0);
    const monthlyPrice = Number(plan.monthlyPrice || 0);
    const projectedOverageCredits = round2(Math.max(0, roundedBaseCredits - includedCredits));
    const projectedOverageCharge = round2(projectedOverageCredits * config.paygOveragePrice);
    const projectedUnusedCredits = round2(Math.max(0, includedCredits - roundedBaseCredits));
    const projectedUnusedRebate = round2(projectedUnusedCredits * config.unusedCreditRebateRate);
    const includedCreditFaceValue = round2(includedCredits * config.unusedCreditRebateRate);
    const nonRefundableServicePortion = round2(Math.max(0, monthlyPrice - includedCreditFaceValue));
    const effectiveCreditRate = includedCredits > 0 ? round2(monthlyPrice / includedCredits) : 0;
    const projectedMonthlyTotal = round2(monthlyPrice + projectedOverageCharge);
    const projectedNetCost = round2(projectedMonthlyTotal - projectedUnusedRebate);
    return {
      ...plan,
      projectedUsageCredits: roundedBaseCredits,
      projectedOverageCredits,
      projectedOverageCharge,
      projectedOverageRate: round2(config.paygOveragePrice),
      projectedUnusedCredits,
      projectedUnusedRebate,
      includedCreditFaceValue,
      nonRefundableServicePortion,
      effectiveCreditRate,
      projectedMonthlyTotal,
      projectedNetCost
    };
  });

  const recommendedComparison = recommendedPlan && Number.isFinite(recommendedPlan.monthlyPrice)
    ? comparison.find(plan => plan.code === recommendedPlan.code) || null
    : null;

  const lowerTierComparison = recommendedComparison
    ? comparison
        .filter(plan => Number(plan.sortOrder) < Number(recommendedPlan.sortOrder))
        .map(plan => ({
          ...plan,
          projectedSavings: round2(plan.projectedNetCost - recommendedComparison.projectedNetCost)
        }))
    : [];
  const largestIncludedPlan = eligiblePlans.reduce((largest, plan) => Math.max(largest, Number(plan.includedCredits || 0)), 0);

  return {
    config,
    plans: publicPlans,
    inputs: {
      averageConcurrentViewers,
      hoursPerShow,
      showsPerMonth,
      recordingRetentionDays,
      replayReservePercentage,
      safetyBufferPercentage
    },
    metrics: {
      liveViewerMinutes: round2(liveViewerMinutes),
      replayReserveMinutes: round2(replayReserveMinutes),
      projectedDeliveredMinutes: round2(projectedDeliveredMinutes),
      monthlyRecordedMinutes: round2(monthlyRecordedMinutes),
      retentionMonths: round2(retentionMonths),
      projectedStoredMinutes: round2(projectedStoredMinutes),
      deliveryCredits: round2(deliveryCredits),
      storageCredits: round2(storageCredits),
      projectedBaseCredits: roundedBaseCredits,
      recommendedCreditCapacity: roundedCapacity
    },
    recommendedPlan,
    comparison,
    lowerTierComparison,
    enterpriseRequired: !recommendedPlan || recommendedPlan.code === "enterprise" || roundedCapacity > largestIncludedPlan
  };
}

function calculateActualCredits(usage = {}, rawConfig = DEFAULT_CONFIG) {
  const config = normalizeConfig(rawConfig);
  const deliveredMinutes = Number(usage.actualDeliveredMinutes || 0);
  const storedMinutes = Number(usage.actualStoredMinutes || 0);
  return round2((deliveredMinutes / config.deliveryMinutesPerCredit) + (storedMinutes / config.storageMinutesPerCredit));
}

function calculateLiveMeterCredits({ elapsedMilliseconds = 0, viewerCount = 0 } = {}, rawConfig = DEFAULT_CONFIG) {
  const config = normalizeConfig(rawConfig);
  const elapsedMinutes = Math.max(0, Number(elapsedMilliseconds || 0)) / 60000;
  const viewers = Math.max(0, Number(viewerCount || 0));
  return Math.max(0,
    (elapsedMinutes * viewers / config.deliveryMinutesPerCredit) +
    (elapsedMinutes / config.storageMinutesPerCredit)
  );
}

function validatePlanEconomics(rawPlans = DEFAULT_PLANS, rawConfig = DEFAULT_CONFIG) {
  const plans = normalizePlans(rawPlans);
  const config = normalizeConfig(rawConfig);
  for (const plan of plans) {
    const hasPrice = Number.isFinite(plan.monthlyPrice);
    const hasCredits = Number.isFinite(plan.includedCredits);
    if (!hasPrice && !hasCredits) continue;
    if (!hasPrice || !hasCredits || plan.monthlyPrice <= 0 || plan.includedCredits < 25) {
      return { valid: false, error: `${plan.name || "Plan"} needs a positive price and at least 25 included credits.` };
    }
    const increments = plan.includedCredits / 25;
    if (Math.abs(increments - Math.round(increments)) > 1e-8) {
      return { valid: false, error: `${plan.name} included credits must use 25-credit increments.` };
    }
    const refundableFaceValue = round2(plan.includedCredits * config.unusedCreditRebateRate);
    if (plan.monthlyPrice + Number.EPSILON < refundableFaceValue) {
      return { valid: false, error: `${plan.name} must cost at least $${refundableFaceValue.toFixed(2)} to cover its unused-credit face value.` };
    }
  }
  return { valid: true, error: "" };
}

function creditPurchaseQuote(rawQuantity, { subscriber = false } = {}, rawConfig = DEFAULT_CONFIG) {
  const numericQuantity = Number(rawQuantity);
  if (!Number.isFinite(numericQuantity)) return null;
  const hundredths = Math.round(numericQuantity * 100);
  if (Math.abs((numericQuantity * 100) - hundredths) > 1e-7 || hundredths < 100 || hundredths > 1_000_000) return null;
  const quantity = hundredths / 100;
  const config = normalizeConfig(rawConfig);
  const unitPrice = subscriber ? config.subscriberExtraCreditPrice : config.prepaidExtraCreditPrice;
  const amountCents = Math.round(quantity * unitPrice * 100);
  if (!Number.isInteger(amountCents) || amountCents < 50) return null;
  return {
    quantity,
    subscriber: Boolean(subscriber),
    unitPrice: round2(unitPrice),
    amountCents,
    totalAmount: round2(amountCents / 100)
  };
}

function estimateDashboard(subscription = {}, usage = {}, rawConfig = DEFAULT_CONFIG, rawPlans = DEFAULT_PLANS) {
  const projection = calculateProjection({
    averageConcurrentViewers: subscription.average_concurrent_viewers,
    hoursPerShow: subscription.hours_per_show,
    showsPerMonth: subscription.shows_per_month,
    recordingRetentionDays: subscription.recording_retention_days,
    replayReservePercentage: subscription.replay_reserve_percentage,
    safetyBufferPercentage: subscription.safety_buffer_percentage
  }, rawConfig, rawPlans);
  const includedCredits = Number(subscription.included_credits || 0);
  const prepaidCreditsBalance = Number(subscription.prepaid_credits_balance || 0);
  const totalCreditsAvailable = round2(includedCredits + prepaidCreditsBalance);
  const actualCreditsUsed = calculateActualCredits({
    actualDeliveredMinutes: usage.actual_delivered_minutes,
    actualStoredMinutes: usage.actual_stored_minutes
  }, rawConfig);
  const creditsRemaining = round2(Math.max(0, totalCreditsAvailable - actualCreditsUsed));
  const projectedEndOfMonthUsage = round2(Math.max(actualCreditsUsed, projection.metrics.projectedBaseCredits));
  const projectedUnusedCredits = round2(Math.max(0, includedCredits - projectedEndOfMonthUsage));
  const projectedRebate = round2(projectedUnusedCredits * projection.config.unusedCreditRebateRate);
  const projectedOverage = round2(Math.max(0, projectedEndOfMonthUsage - includedCredits));
  const utilization = totalCreditsAvailable > 0 ? round2((actualCreditsUsed / totalCreditsAvailable) * 100) : 0;
  return {
    includedCredits: round2(includedCredits),
    prepaidCreditsBalance: round2(prepaidCreditsBalance),
    totalCreditsAvailable,
    actualCreditsUsed,
    creditsRemaining,
    projectedEndOfMonthUsage,
    projectedUnusedCredits,
    projectedRebate,
    projectedOverage,
    utilization,
    recommendedPlan: projection.recommendedPlan,
    metrics: projection.metrics
  };
}

function nextAlertThreshold(utilization) {
  return [50, 75, 90, 100].find(threshold => Number(utilization || 0) < threshold) || null;
}

export {
  DAY_MINUTES,
  DEFAULT_CONFIG,
  DEFAULT_PLANS,
  normalizeConfig,
  normalizePlans,
  validatePlanEconomics,
  calculateProjection,
  calculateActualCredits,
  calculateLiveMeterCredits,
  creditPurchaseQuote,
  estimateDashboard,
  nextAlertThreshold,
  round2
};
