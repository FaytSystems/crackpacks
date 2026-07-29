import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0047_add_auction_payment_settlements.sql", import.meta.url), "utf8");

test("auction settlement migration enforces one payment and order per lot", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE members(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_stream_sessions(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_auction_lots(id TEXT PRIMARY KEY);
    INSERT INTO members(id) VALUES('seller-1'),('buyer-1'),('buyer-2'),('buyer-3');
    INSERT INTO breaker_stream_sessions(id) VALUES('show-1');
    INSERT INTO breaker_auction_lots(id) VALUES('lot-1'),('lot-2'),('lot-3');
  `);
  db.exec(migration);

  assert.ok(db.prepare(`SELECT name FROM pragma_table_info('breaker_auction_lots') WHERE name='seller_store_listing_id'`).get());
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='breaker_auction_payments'`).get());
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_breaker_auction_payments_stripe_intent'`).get());

  const insert = db.prepare(`
    INSERT INTO breaker_auction_payments(
      lot_id,session_id,seller_member_id,buyer_member_id,member_order_id,order_number,
      amount_cents,currency,status,attempted_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const values = [
    "lot-1", "show-1", "seller-1", "buyer-1", "order-1", "CP-AUCTION-1",
    2500, "USD", "processing", "2026-07-28T10:00:00.000Z",
    "2026-07-28T10:00:00.000Z", "2026-07-28T10:00:00.000Z"
  ];
  insert.run(...values);
  assert.throws(() => insert.run(...values));
  assert.throws(() => insert.run(
    "lot-2", "show-1", "seller-1", "buyer-2", "order-1", "CP-AUCTION-2",
    2600, "USD", "processing", "2026-07-28T10:01:00.000Z",
    "2026-07-28T10:01:00.000Z", "2026-07-28T10:01:00.000Z"
  ));
  assert.throws(() => insert.run(
    "lot-3", "show-1", "seller-1", "buyer-3", "order-3", "CP-AUCTION-3",
    2700, "USD", "complete", "2026-07-28T10:02:00.000Z",
    "2026-07-28T10:02:00.000Z", "2026-07-28T10:02:00.000Z"
  ));
  db.close();
});
