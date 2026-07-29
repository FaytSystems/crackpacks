import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migration = readFileSync(new URL("migrations/0050_marketplace_launch_realtime_payouts.sql", root), "utf8");
const worker = readFileSync(new URL("src/platform-routes.js", root), "utf8");
const room = readFileSync(new URL("src/show-auction-room.js", root), "utf8");
const wrangler = readFileSync(new URL("wrangler.jsonc", root), "utf8");

test("marketplace launch migration adds payouts, fee accounting, abuse controls, and analytics", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE members(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_profiles(member_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT);
    CREATE TABLE breaker_stream_sessions(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_auction_lots(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_auction_bids(
      id TEXT PRIMARY KEY,lot_id TEXT,bidder_member_id TEXT,amount_cents INTEGER,status TEXT,created_at TEXT
    );
    CREATE TABLE breaker_auction_payments(
      lot_id TEXT PRIMARY KEY,session_id TEXT,seller_member_id TEXT,buyer_member_id TEXT,
      member_order_id TEXT,order_number TEXT,amount_cents INTEGER,currency TEXT,status TEXT,
      stripe_payment_intent_id TEXT,failure_code TEXT,failure_message TEXT,attempted_at TEXT,
      paid_at TEXT,inventory_adjusted_at TEXT,created_at TEXT,updated_at TEXT
    );
  `);
  db.exec(migration);
  const profileColumns = new Set(db.prepare(`SELECT name FROM pragma_table_info('breaker_profiles')`).all().map(row => row.name));
  const paymentColumns = new Set(db.prepare(`SELECT name FROM pragma_table_info('breaker_auction_payments')`).all().map(row => row.name));
  assert.ok(profileColumns.has("stripe_connect_payouts_enabled"));
  assert.ok(profileColumns.has("stripe_connect_charges_enabled"));
  assert.ok(paymentColumns.has("seller_proceeds_cents"));
  assert.ok(paymentColumns.has("application_fee_cents"));
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='auction_bid_requests'`).get());
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='client_analytics_events'`).get());
  db.close();
});

test("live auction worker binds a hibernating Durable Object and publishes state changes", () => {
  assert.match(wrangler, /SHOW_AUCTION_ROOM/);
  assert.match(wrangler, /new_sqlite_classes/);
  assert.match(room, /acceptWebSocket/);
  assert.match(room, /getWebSockets/);
  assert.match(worker, /bid\.accepted/);
  assert.match(worker, /auction\.advanced/);
  assert.match(worker, /show\.ended/);
});

test("seller Connect is required in production before paid auctions", () => {
  assert.match(wrangler, /"SELLER_PAYOUTS_REQUIRED": "true"/);
  assert.match(worker, /SELLER_PAYOUT_SETUP_REQUIRED/);
  assert.match(worker, /capabilities\[card_payments\]\[requested\]/);
  assert.match(worker, /capabilities\[transfers\]\[requested\]/);
  assert.match(worker, /transfer_data\[destination\]/);
  assert.match(worker, /application_fee_amount/);
  assert.match(worker, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(worker, /account\.updated/);
});
