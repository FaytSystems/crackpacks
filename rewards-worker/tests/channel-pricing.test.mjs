import assert from "node:assert/strict";
import test from "node:test";
import { calculateChannelPricing, channelPricingErrors } from "../src/channel-pricing.js";

const configured = {
  cogsCents: 10000,
  usShippingCents: 800,
  packagingCents: 100,
  overheadCents: 350,
  retailFixedFeeCents: 30,
  wholesaleHandlingCents: 100
};

test("channel pricing uses the requested safe-floor formulas and rounds up", () => {
  const { floors, prices } = calculateChannelPricing(configured);
  assert.equal(floors.retail, Math.ceil(10380 / 0.723));
  assert.equal(floors.websiteUs, Math.ceil(11280 / 0.771));
  assert.equal(floors.websiteInternational, Math.ceil(10480 / 0.771));
  assert.equal(floors.whatnot, Math.ceil(10480 / 0.70));
  assert.equal(floors.wholesaleSmall, Math.ceil(10100 / 0.85));
  assert.equal(floors.wholesaleCase, Math.ceil(10100 / 0.88));
  assert.equal(floors.wholesalePallet, Math.ceil(10100 / 0.90));
  assert.deepEqual(prices, floors);
});

test("market list prices can raise but never lower a channel floor", () => {
  const base = calculateChannelPricing(configured);
  const raised = calculateChannelPricing({ ...configured, websiteListPriceCents: base.floors.websiteUs + 2500 });
  assert.equal(raised.prices.websiteUs, base.floors.websiteUs + 2500);
  assert.deepEqual(channelPricingErrors({ ...configured, websiteListPriceCents: base.floors.websiteUs - 1 }), ["USA website list price cannot be lower than its calculated safe floor."]);
});

test("a list-price override is rejected when its required costs are incomplete", () => {
  assert.deepEqual(channelPricingErrors({ cogsCents: 10000, websiteListPriceCents: 15000 }), ["USA website list price needs all of its cost inputs before a safe floor can be verified."]);
  assert.equal(calculateChannelPricing({ cogsCents: 10000 }).prices.websiteUs, null);
});
