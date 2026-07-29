import process from "node:process";

const args = new Set(process.argv.slice(2));
const requireLive = args.has("--require-live");
const endpoints = {
  rewards: process.env.REWARDS_API_URL || "https://rewards-api.crackpacks.com",
  cards: process.env.CARD_API_URL || "https://api.crackpacks.com",
  contact: process.env.CONTACT_API_URL || "https://contact-api.crackpacks.com"
};

async function requestJson(label, url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  return {
    label,
    status: response.status,
    ok: response.ok,
    durationMs: Math.round(performance.now() - started),
    payload
  };
}

const checks = await Promise.all([
  requestJson("Rewards health", `${endpoints.rewards}/health`),
  requestJson("Marketplace status", `${endpoints.rewards}/marketplace/status`),
  requestJson("Live directory", `${endpoints.rewards}/live/shows`),
  requestJson("Protected payout gate", `${endpoints.rewards}/seller/payouts/status`),
  requestJson("Card-search health", `${endpoints.cards}/health`),
  requestJson("Contact health", `${endpoints.contact}/health`)
]);

const failures = [];
for (const check of checks) {
  const protectedGateOk = check.label === "Protected payout gate" && check.status === 401;
  const passed = check.ok || protectedGateOk;
  console.log(`${passed ? "PASS" : "FAIL"} ${check.label}: HTTP ${check.status} (${check.durationMs} ms)`);
  if (!passed) failures.push(`${check.label} returned HTTP ${check.status}`);
}

const rewards = checks.find(check => check.label === "Rewards health")?.payload || {};
const marketplace = checks.find(check => check.label === "Marketplace status")?.payload || {};
const contact = checks.find(check => check.label === "Contact health")?.payload || {};
const readiness = {
  "rewards service": rewards.ok === true,
  "real-time auctions": rewards.realtimeAuctionsConfigured === true,
  "seller payout gate": rewards.sellerPayoutsRequired === true,
  "contact email": contact.configured === true,
  "card API": checks.find(check => check.label === "Card-search health")?.payload?.ok === true
};
for (const [name, ready] of Object.entries(readiness)) {
  console.log(`${ready ? "READY" : "CHECK"} ${name}`);
  if (!ready) failures.push(`${name} is not ready`);
}

console.log(`INFO marketplace mode: ${marketplace.mode || rewards.marketplaceMode || "unknown"}`);
console.log(`INFO active listings: ${Number(marketplace.activeListings || 0)}`);
console.log(`INFO payout-ready sellers: ${Number(marketplace.payoutReadySellers || 0)}`);
console.log(`INFO live shows: ${Number(marketplace.liveShows || 0)}`);
console.log(`INFO Turnstile: ${contact.turnstileConfigured ? "configured" : "staged; secret not configured"}`);

if (requireLive && (marketplace.mode !== "live" || marketplace.checkoutEnabled !== true)) {
  failures.push("marketplace is not in live checkout mode");
}
if (failures.length) {
  console.error(`\nLaunch rehearsal found ${failures.length} blocking check(s):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nLaunch rehearsal passed.");
}
