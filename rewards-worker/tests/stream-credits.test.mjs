import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  DEFAULT_PLANS,
  calculateActualCredits,
  calculateProjection,
  creditPurchaseQuote,
  estimateDashboard,
  validatePlanEconomics
} from "../src/stream-credits.js";

test("stream credit projection recommends the smallest public plan with buffer", () => {
  const result = calculateProjection({
    averageConcurrentViewers: 150,
    hoursPerShow: 3,
    showsPerMonth: 4
  });
  assert.equal(result.recommendedPlan.code, "pro");
  assert.equal(result.metrics.liveViewerMinutes, 108000);
  assert.equal(result.metrics.projectedBaseCredits, 129.6);
  assert.equal(result.metrics.recommendedCreditCapacity, 155.52);
});

test("lower tier comparison includes overage and rebate net cost", () => {
  const result = calculateProjection({
    averageConcurrentViewers: 80,
    hoursPerShow: 2,
    showsPerMonth: 6
  });
  const growth = result.comparison.find(plan => plan.code === "growth");
  assert.ok(growth);
  assert.equal(typeof growth.projectedNetCost, "number");
  assert.equal(typeof growth.projectedUnusedRebate, "number");
  assert.equal(growth.projectedOverageRate, 1.25);
  assert.equal(growth.includedCreditFaceValue, 75);
  assert.equal(growth.nonRefundableServicePortion, 24);
});

test("actual usage credits combine delivered and stored minutes", () => {
  assert.equal(calculateActualCredits({ actualDeliveredMinutes: 5000, actualStoredMinutes: 400 }), 7);
});

test("dashboard estimate reports remaining credits and projected rebate", () => {
  const dashboard = estimateDashboard({
    included_credits: 130,
    average_concurrent_viewers: 20,
    hours_per_show: 2,
    shows_per_month: 4,
    recording_retention_days: 90,
    replay_reserve_percentage: 0.10,
    safety_buffer_percentage: 0.20
  }, {
    actual_delivered_minutes: 8000,
    actual_stored_minutes: 600
  });
  assert.equal(dashboard.actualCreditsUsed, 11);
  assert.equal(dashboard.creditsRemaining, 119);
  assert.ok(dashboard.projectedRebate >= 0);
});

test("rebate estimate never ignores higher actual usage", () => {
  const subscription = {
    included_credits: 200,
    average_concurrent_viewers: 20,
    hours_per_show: 2,
    shows_per_month: 4,
    recording_retention_days: 90,
    replay_reserve_percentage: 0.10,
    safety_buffer_percentage: 0.20
  };
  const fiveUnused = estimateDashboard(subscription, {
    actual_delivered_minutes: 195000,
    actual_stored_minutes: 0
  });
  assert.equal(fiveUnused.actualCreditsUsed, 195);
  assert.equal(fiveUnused.projectedEndOfMonthUsage, 195);
  assert.equal(fiveUnused.projectedUnusedCredits, 5);
  assert.equal(fiveUnused.projectedRebate, 5);

  const fullyUsed = estimateDashboard(subscription, {
    actual_delivered_minutes: 200000,
    actual_stored_minutes: 0
  });
  assert.equal(fullyUsed.actualCreditsUsed, 200);
  assert.equal(fullyUsed.projectedUnusedCredits, 0);
  assert.equal(fullyUsed.projectedRebate, 0);
});

test("default plans cover four seller profiles in 25-credit increments", () => {
  assert.deepEqual(DEFAULT_PLANS.map(({ code, monthlyPrice, includedCredits }) => ({ code, monthlyPrice, includedCredits })), [
    { code: "starter", monthlyPrice: 29, includedCredits: 25 },
    { code: "growth", monthlyPrice: 99, includedCredits: 75 },
    { code: "pro", monthlyPrice: 525, includedCredits: 425 },
    { code: "power", monthlyPrice: 1999, includedCredits: 1600 },
    { code: "enterprise", monthlyPrice: null, includedCredits: null }
  ]);
  assert.ok(DEFAULT_PLANS.filter(plan => Number.isFinite(plan.includedCredits)).every(plan => plan.includedCredits % 25 === 0));
  assert.equal(DEFAULT_CONFIG.paygOveragePrice, 1.25);

  const profiles = [
    [{ averageConcurrentViewers: 10, hoursPerShow: 2, showsPerMonth: 2 }, "starter"],
    [{ averageConcurrentViewers: 25, hoursPerShow: 3, showsPerMonth: 8 }, "growth"],
    [{ averageConcurrentViewers: 50, hoursPerShow: 4, showsPerMonth: 20 }, "pro"],
    [{ averageConcurrentViewers: 150, hoursPerShow: 5, showsPerMonth: 24 }, "power"],
    [{ averageConcurrentViewers: 200, hoursPerShow: 6, showsPerMonth: 30 }, "enterprise"]
  ];
  profiles.forEach(([inputs, expectedCode]) => assert.equal(calculateProjection(inputs).recommendedPlan.code, expectedCode));
});

test("plan economics protect 25-credit increments and refundable face value", () => {
  assert.equal(validatePlanEconomics(DEFAULT_PLANS).valid, true);
  assert.match(validatePlanEconomics([{ code: "bad", name: "Bad", monthlyPrice: 49, includedCredits: 50 }]).error, /at least \$50\.00/);
  assert.match(validatePlanEconomics([{ code: "bad", name: "Bad", monthlyPrice: 50, includedCredits: 40 }]).error, /25-credit increments/);
});

test("a-la-carte credit quote accepts hundredths and applies account pricing", () => {
  assert.deepEqual(creditPurchaseQuote(1.01), {
    quantity: 1.01,
    subscriber: false,
    unitPrice: 1.5,
    amountCents: 152,
    totalAmount: 1.52
  });
  assert.deepEqual(creditPurchaseQuote("25.25", { subscriber: true }), {
    quantity: 25.25,
    subscriber: true,
    unitPrice: 1.25,
    amountCents: 3156,
    totalAmount: 31.56
  });
});

test("a-la-carte credit quote enforces minimum and two-decimal precision", () => {
  assert.equal(creditPurchaseQuote(0.99), null);
  assert.equal(creditPurchaseQuote(1.001), null);
  assert.equal(creditPurchaseQuote(10000.01), null);
});

test("dashboard remaining balance includes purchased rollover credits", () => {
  const dashboard = estimateDashboard({
    included_credits: 30,
    prepaid_credits_balance: 4.25
  }, {
    actual_delivered_minutes: 5000,
    actual_stored_minutes: 0
  });
  assert.equal(dashboard.totalCreditsAvailable, 34.25);
  assert.equal(dashboard.creditsRemaining, 29.25);
});
