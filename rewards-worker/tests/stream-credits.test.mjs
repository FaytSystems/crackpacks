import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateActualCredits,
  calculateProjection,
  estimateDashboard
} from "../src/stream-credits.js";

test("stream credit projection recommends the smallest public plan with buffer", () => {
  const result = calculateProjection({
    averageConcurrentViewers: 150,
    hoursPerShow: 3,
    showsPerMonth: 4
  });
  assert.equal(result.recommendedPlan.code, "power");
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
