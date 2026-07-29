import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("Seller Hub exposes the connected Seller Live cockpit controls", async () => {
  const html = await read("streams.html");
  const createIndex = html.indexOf("data-seller-tool-button=\"shows\">Create Show");
  const goLiveIndex = html.indexOf("data-seller-tool-button=\"show-control\"");
  assert.ok(createIndex >= 0);
  assert.ok(goLiveIndex > createIndex);
  assert.match(html, /href="#seller-live"/);
  assert.match(html, /data-seller-broadcast-player/);
  assert.match(html, /data-broadcast-sale-list/);
  assert.match(html, /data-auction-next/);
  assert.match(html, /data-auto-next-stop/);
  assert.match(html, /data-auto-next-duration/);
  assert.match(html, /data-seller-tool-button="show-inventory"/);
  assert.match(html, /data-seller-tool-button="inventory"/);
  const auctionIndex = html.indexOf("seller-auction-console");
  const videoIndex = html.indexOf("seller-broadcast-monitor");
  const chatIndex = html.indexOf("seller-live-chat");
  assert.ok(auctionIndex >= 0);
  assert.ok(auctionIndex < videoIndex);
  assert.ok(videoIndex < chatIndex);
  assert.match(html, /data-chat-messages/);
  assert.match(html, /data-chat-form/);
  assert.match(html, /data-seller-video-auction-hud/);
  assert.match(html, /data-seller-video-auction-title/);
  assert.match(html, /data-seller-video-auction-bid/);
  assert.match(html, /data-seller-bid-preview/);
  assert.match(html, /data-seller-custom-bid-preview/);
});

test("Seller Live long-press and queue-selection behavior is wired", async () => {
  const script = await read("assets/js/streams-hub.js");
  assert.match(script, /AUTO_NEXT_HOLD_MS = 3000/);
  assert.match(script, /pointerdown/);
  assert.match(script, /startAutoNext/);
  assert.match(script, /stopAutoNext/);
  assert.match(script, /data-queue-move/);
  assert.match(script, /data-queue-run/);
  assert.match(script, /lots\/reorder/);
  assert.match(script, /nextLotId/);
});

test("Seller Live creates and selects a show without leaving the HUD", async () => {
  const [html, script, css] = await Promise.all([
    read("streams.html"),
    read("assets/js/streams-hub.js"),
    read("assets/css/streams-hub.css")
  ]);
  assert.match(html, /data-broadcast-show-picker/);
  assert.match(html, /data-hud-create-show-open/);
  assert.match(html, /data-hud-create-show-modal/);
  assert.match(html, /data-hud-seller-show-form/);
  assert.match(html, />Create and select show</);
  assert.match(script, /broadcastSelect\.hidden = !active\.length/);
  assert.match(script, /createSellerShowFromForm/);
  assert.match(script, /await selectSellerShow\(created\.id\)/);
  assert.match(script, /Show created and selected/);
  assert.match(css, /\.seller-create-show-bubble/);
  assert.match(css, /\.seller-create-show-modal/);
});

test("Seller Live inventory modal searches, sorts, paginates, and assigns products to shows", async () => {
  const [html, script, css, routes] = await Promise.all([
    read("streams.html"),
    read("assets/js/streams-hub.js"),
    read("assets/css/streams-hub.css"),
    read("rewards-worker/src/platform-routes.js")
  ]);
  assert.match(html, /data-hud-inventory-open/);
  assert.match(html, /data-hud-inventory-modal/);
  assert.match(html, /data-hud-inventory-search/);
  assert.match(html, /data-hud-inventory-sort/);
  assert.match(html, /data-hud-inventory-new-form/);
  assert.match(html, /data-hud-inventory-list/);
  assert.match(html, /data-hud-inventory-page="previous">Previous/);
  assert.match(html, /data-hud-inventory-page="next">Next/);
  assert.match(html, /data-hud-inventory-assignment-form/);
  assert.match(html, /data-hud-inventory-show-options/);
  assert.match(script, /HUD_INVENTORY_PAGE_SIZE = 10/);
  assert.match(script, /items\.slice\(pageStart, pageStart \+ HUD_INVENTORY_PAGE_SIZE\)/);
  assert.match(script, /function hudInventoryItems\(\)/);
  assert.match(script, /data-hud-add-to-show/);
  assert.match(script, /status: "inactive"/);
  assert.match(script, /\/seller\/shows\/\$\{encodeURIComponent\(showId\)\}\/lots/);
  assert.match(css, /\.seller-hud-inventory-row/);
  assert.match(css, /\.seller-hud-add-show-bubble/);
  assert.match(routes, /status IN \('active','inactive'\) AND quantity>=\?/);
});

test("Seller Live alone collapses the Seller Hub subheader into a dropdown", async () => {
  const [html, script, css] = await Promise.all([
    read("streams.html"),
    read("assets/js/streams-hub.js"),
    read("assets/css/streams-hub.css")
  ]);
  assert.match(html, /data-seller-tool-menu-toggle/);
  assert.match(html, /aria-controls="seller-tool-menu-items"/);
  assert.match(html, /data-seller-tool-menu-current>Seller Live/);
  assert.match(script, /document\.body\.dataset\.sellerTool === "show-control"/);
  assert.match(script, /setSellerToolMenuOpen\(false\)/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(css, /body\[data-seller-tool="show-control"\] \.seller-tool-menu-toggle/);
  assert.match(css, /body\[data-seller-tool="show-control"\] \.seller-tool-menu\.is-open \.seller-tool-menu-items/);
  assert.doesNotMatch(css, /body\[data-seller-tool="(?!show-control)[^"]+"\] \.seller-tool-menu-toggle/);
});

test("Live Shows gives the owning seller an exact-show GO LIVE NOW handoff", async () => {
  const script = await read("assets/js/streams-hub.js");
  assert.match(script, /data-seller-go-live/);
  assert.match(script, /GO LIVE NOW/);
  assert.match(script, /status\.sellerAccess/);
  assert.match(script, /status\.sellerUsername/);
  assert.match(script, /\/portal\/mode/);
  assert.match(script, /streams\.html\?show=\$\{encodeURIComponent\(show\.id\)\}#seller-live/);
  assert.match(script, /requestedSellerShowId/);
});

test("desktop live rooms order auction, video, and shared chat", async () => {
  const [liveHtml, sellerCss, liveCss, chatScript] = await Promise.all([
    read("live.html"),
    read("assets/css/streams-hub.css"),
    read("assets/css/live.css"),
    read("assets/js/live-chat.js")
  ]);
  const auctionIndex = liveHtml.indexOf("live-bid-card");
  const videoIndex = liveHtml.indexOf("live-video-card");
  const chatIndex = liveHtml.indexOf("live-chat-card");
  assert.ok(auctionIndex >= 0);
  assert.ok(auctionIndex < videoIndex);
  assert.ok(videoIndex < chatIndex);
  assert.match(sellerCss, /grid-template-areas:\s*"auction video chat"/);
  assert.match(liveCss, /grid-template-areas:\s*"auction video chat"/);
  assert.match(chatScript, /encodeURIComponent\(activeShowId\).*\/chat/s);
  assert.match(chatScript, /escapeHtml\(message\.message/);
  assert.match(chatScript, /setInterval\(refresh/);
});

test("video auction HUD exposes live buyer bids and a locked seller preview", async () => {
  const [liveHtml, liveScript, sellerScript, hudCss, routes] = await Promise.all([
    read("live.html"),
    read("assets/js/live.js"),
    read("assets/js/streams-hub.js"),
    read("assets/css/video-auction-hud.css"),
    read("rewards-worker/src/platform-routes.js")
  ]);
  assert.match(liveHtml, /data-video-auction-hud/);
  assert.match(liveHtml, /data-video-auction-quick-bid/);
  assert.match(liveHtml, /data-video-auction-custom-toggle/);
  assert.match(liveHtml, /data-video-auction-custom-form/);
  assert.match(liveScript, /renderVideoAuctionHud/);
  assert.match(liveScript, /videoQuickBid\.addEventListener\("click"/);
  assert.match(liveScript, /placeBid\(\{ bidAmount \}\)/);
  assert.match(sellerScript, /renderSellerVideoAuctionHud/);
  assert.match(sellerScript, /quickBid\.textContent = `BID \$\{dollars\(minimumCents\)\}`/);
  assert.match(hudCss, /\.video-auction-hud\[data-state="live"\]/);
  assert.match(hudCss, /@media \(max-width: 520px\)/);
  assert.match(routes, /Sellers cannot bid on their own auction\./);
});

test("Seller Live shows confirmed purchases for two seconds and links the recap to fulfillment", async () => {
  const [html, script, css, routes, worker, wrangler] = await Promise.all([
    read("streams.html"),
    read("assets/js/streams-hub.js"),
    read("assets/css/streams-hub.css"),
    read("rewards-worker/src/platform-routes.js"),
    read("rewards-worker/src/index.js"),
    read("rewards-worker/wrangler.jsonc")
  ]);
  assert.match(html, /data-seller-purchase-toast/);
  assert.match(html, />PURCHASED</);
  assert.match(html, /data-seller-purchase-recap-list/);
  assert.match(html, />FULFILL ORDERS</);
  assert.match(script, /purchase\.paymentStatus !== "paid"/);
  assert.match(script, /window\.setTimeout\(\(\) => \{[\s\S]*toast\.hidden = true;[\s\S]*\}, 2000\)/);
  assert.match(script, /data-fulfill-order/);
  assert.match(script, /setSellerTool\("shipping"\)/);
  assert.match(script, /\}, 2500\)/);
  assert.match(css, /\.seller-purchase-toast/);
  assert.match(css, /background: #75ffb7/);
  assert.match(routes, /off_session/);
  assert.match(routes, /live-auction-\$\{lot\.id\}/);
  assert.match(routes, /INSERT OR IGNORE INTO member_orders/);
  assert.match(script, /settle-expired/);
  assert.match(routes, /runAuctionSettlementCycle/);
  assert.match(worker, /runAuctionSettlementCycle\(env\)/);
  assert.match(wrangler, /"\* \* \* \* \*"/);
});

test("END SHOW terminates the public feed and removes the public directory card", async () => {
  const [sellerScript, publicScript, routes] = await Promise.all([
    read("assets/js/streams-hub.js"),
    read("assets/js/live.js"),
    read("rewards-worker/src/platform-routes.js")
  ]);
  assert.match(sellerScript, /Promise\.all\(\[loadSellerShows\(\), loadShows\(\)\]\)/);
  assert.match(sellerScript, /removed from Public Live Shows/);
  assert.match(sellerScript, /\}, 5000\)/);
  assert.match(publicScript, /const endPublicShow = show =>/);
  assert.match(publicScript, /data\.ended/);
  assert.match(publicScript, /els\.player\.src = "about:blank"/);
  assert.match(publicScript, /clearInterval\(refreshTimer\)/);
  assert.match(publicScript, /liveChat\?\.stop\(\)/);
  assert.match(routes, /SET status='ended',viewer_count=0/);
  assert.match(routes, /publicRemoved: true/);
});
