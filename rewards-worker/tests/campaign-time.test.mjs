import assert from "node:assert/strict";
import test from "node:test";
import { campaignWeekAt, parseCampaignExpiryHours } from "../src/campaign-time.js";

const vectors = [
  ["2026-07-16T03:59:59.999Z", "2026-07-09", "2026-07-09T04:00:00.000Z", "2026-07-16T04:00:00.000Z"],
  ["2026-07-16T04:00:00.000Z", "2026-07-16", "2026-07-16T04:00:00.000Z", "2026-07-23T04:00:00.000Z"],
  ["2026-07-22T23:59:59.999Z", "2026-07-16", "2026-07-16T04:00:00.000Z", "2026-07-23T04:00:00.000Z"],
  ["2026-03-05T05:00:00.000Z", "2026-03-05", "2026-03-05T05:00:00.000Z", "2026-03-12T04:00:00.000Z"],
  ["2026-03-12T03:59:59.999Z", "2026-03-05", "2026-03-05T05:00:00.000Z", "2026-03-12T04:00:00.000Z"],
  ["2026-11-01T12:00:00.000Z", "2026-10-29", "2026-10-29T04:00:00.000Z", "2026-11-05T05:00:00.000Z"],
  ["2027-01-01T12:00:00.000Z", "2026-12-31", "2026-12-31T05:00:00.000Z", "2027-01-07T05:00:00.000Z"]
];

test("campaign weeks reset Thursday at midnight in New York", () => {
  for (const [at, key, startsAt, expiresAt] of vectors) {
    assert.deepEqual(campaignWeekAt(Date.parse(at)), { key, startsAt, expiresAt });
  }
});

test("campaign week duration follows New York daylight-saving transitions", () => {
  const spring = campaignWeekAt(Date.parse("2026-03-08T12:00:00.000Z"));
  const fall = campaignWeekAt(Date.parse("2026-11-01T12:00:00.000Z"));
  assert.equal((Date.parse(spring.expiresAt) - Date.parse(spring.startsAt)) / 3600000, 167);
  assert.equal((Date.parse(fall.expiresAt) - Date.parse(fall.startsAt)) / 3600000, 169);
});

test("campaign expiration accepts decimal durations through seven days", () => {
  assert.equal(parseCampaignExpiryHours(1), 1);
  assert.ok(Math.abs(parseCampaignExpiryHours(3.05 * 24) - 73.2) < Number.EPSILON * 100);
  assert.equal(parseCampaignExpiryHours(168), 168);
  assert.equal(parseCampaignExpiryHours(0.999), null);
  assert.equal(parseCampaignExpiryHours(168.001), null);
  assert.equal(parseCampaignExpiryHours("not-a-number"), null);
});
