import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");

test("buyer store uses one public, paginated marketplace controller", async () => {
  const [html, script, app, css] = await Promise.all([
    read("shop.html"),
    read("assets/js/buyer-store.js"),
    read("assets/js/app.js"),
    read("assets/css/store.css")
  ]);
  assert.match(html, /data-store-catalog/);
  assert.match(html, /data-marketplace-more/);
  assert.match(html, /data-filter-summary/);
  assert.match(html, /assets\/js\/buyer-store\.js/);
  assert.doesNotMatch(html, /assets\/js\/store-enhancements\.js/);
  assert.doesNotMatch(html, /data-store-auth-gate/);
  assert.match(script, /const PAGE_SIZE = 36/);
  assert.match(script, /sessionStorage\.getItem\(CACHE_KEY\)/);
  assert.match(script, /\/marketplace\/listings/);
  assert.match(script, /requestAnimationFrame/);
  assert.doesNotMatch(script, /MutationObserver|setInterval/);
  assert.match(app, /allProducts && !dedicatedStoreCatalog/);
  assert.match(css, /\.buyer-store-shortcuts\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*var\(--site-header-height\)/);
});

test("seller store separates public stock, private inventory, and show stock", async () => {
  const [html, script, css] = await Promise.all([
    read("seller-store.html"),
    read("assets/js/seller-store.js"),
    read("assets/css/seller-store.css")
  ]);
  assert.match(html, /data-store-view-button="stock"/);
  assert.match(html, /data-store-view-button="preview"/);
  assert.match(html, /data-stock-channel="store"/);
  assert.match(html, /data-stock-channel="inventory"/);
  assert.match(html, /data-stock-channel="shows"/);
  assert.match(html, /data-add-listing/);
  assert.match(html, /name="productCategoryKey"/);
  assert.match(html, /name="showId"/);
  assert.match(script, /function listingChannel\(item\)/);
  assert.match(script, /\/seller\/store-listings/);
  assert.match(script, /method:\s*"PATCH"/);
  assert.match(script, /showId/);
  assert.doesNotMatch(script, /sessionStorage/);
  assert.match(css, /\.seller-store-subnav\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*var\(--site-header-height\)/);
});

test("all dashboard submenus remain available beneath the sticky main header", async () => {
  const [styles, referral, admin, employee, streams, policies] = await Promise.all([
    read("assets/css/styles.css"),
    read("assets/css/referral.css"),
    read("assets/css/admin.css"),
    read("assets/css/employee.css"),
    read("assets/css/streams-hub.css"),
    read("assets/css/policies.css")
  ]);
  assert.match(styles, /\.site-header\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*0/);
  assert.match(referral, /\.account-dashboard-subnav\s*\{[\s\S]*position:\s*sticky/);
  assert.match(admin, /\.master-dashboard-nav\s*\{[\s\S]*position:\s*sticky/);
  assert.match(employee, /\.employee-view-nav\s*\{[\s\S]*position:\s*sticky/);
  assert.match(streams, /\.seller-tool-menu\s*\{[\s\S]*position:\s*sticky/);
  assert.match(streams, /body\[data-live-shows-only="true"\] \.hub-tabs\s*\{[\s\S]*position:\s*sticky/);
  assert.match(policies, /\.policy-nav\s*\{[\s\S]*top:\s*calc\(var\(--site-header-height\)/);
});

test("seller store routes and optimized marketplace query are wired in the Worker", async () => {
  const [routes, worker] = await Promise.all([
    read("rewards-worker/src/platform-routes.js"),
    read("rewards-worker/src/index.js")
  ]);
  assert.match(routes, /request\.method === "PATCH" && listingId/);
  assert.match(routes, /sellerStoreListingEditMatch/);
  assert.match(routes, /LEFT JOIN breaker_auction_lots matched_lot/);
  assert.equal((routes.match(/SELECT lot\.id[\s\S]*?FROM breaker_auction_lots lot/g) || []).length >= 1, true);
  assert.match(routes, /stale-while-revalidate=60/);
  assert.match(worker, /GET, POST, PATCH, OPTIONS/);
});

test("Master referral-credit refresh is connected to a protected audit feed", async () => {
  const [html, adminScript, worker] = await Promise.all([
    read("admin.html"),
    read("assets/js/admin.js"),
    read("rewards-worker/src/index.js")
  ]);
  assert.match(html, /data-referral-credit-refresh/);
  assert.match(adminScript, /refreshReferralCredits/);
  assert.match(adminScript, /request\("\/admin\/referral-credits"\)/);
  assert.match(worker, /url\.pathname === "\/admin\/referral-credits"/);
  assert.match(worker, /hasFreshAdminSession\(request, member, env\)/);
  assert.match(worker, /event\.type='referral_credit_awarded'/);
});
