ALTER TABLE breaker_auction_lots ADD COLUMN seller_store_listing_id TEXT;

CREATE INDEX IF NOT EXISTS idx_breaker_auction_lots_store_listing
ON breaker_auction_lots(seller_store_listing_id);

CREATE TABLE IF NOT EXISTS breaker_auction_payments (
  lot_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seller_member_id TEXT NOT NULL,
  buyer_member_id TEXT NOT NULL,
  member_order_id TEXT NOT NULL UNIQUE,
  order_number TEXT NOT NULL UNIQUE CHECK(length(order_number) BETWEEN 1 AND 64),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','paid','failed','requires_action','refunded')),
  stripe_payment_intent_id TEXT,
  failure_code TEXT NOT NULL DEFAULT '' CHECK(length(failure_code) <= 120),
  failure_message TEXT NOT NULL DEFAULT '' CHECK(length(failure_message) <= 500),
  attempted_at TEXT NOT NULL,
  paid_at TEXT,
  inventory_adjusted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(lot_id) REFERENCES breaker_auction_lots(id),
  FOREIGN KEY(session_id) REFERENCES breaker_stream_sessions(id),
  FOREIGN KEY(seller_member_id) REFERENCES members(id),
  FOREIGN KEY(buyer_member_id) REFERENCES members(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_breaker_auction_payments_stripe_intent
ON breaker_auction_payments(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_breaker_auction_payments_session_attempted
ON breaker_auction_payments(session_id, attempted_at ASC);

CREATE INDEX IF NOT EXISTS idx_breaker_auction_payments_seller_status
ON breaker_auction_payments(seller_member_id, status, updated_at DESC);
