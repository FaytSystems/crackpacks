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
