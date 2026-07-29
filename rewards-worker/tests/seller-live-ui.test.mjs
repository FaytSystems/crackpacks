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
