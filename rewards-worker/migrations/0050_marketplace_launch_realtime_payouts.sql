ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_details_submitted INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_details_submitted IN (0,1));
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_charges_enabled IN (0,1));
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_payouts_enabled IN (0,1));
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_requirements_due INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_requirements_due BETWEEN 0 AND 1000);
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_disabled_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE breaker_profiles ADD COLUMN stripe_connect_onboarded_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_breaker_profiles_connect_account
ON breaker_profiles(stripe_connect_account_id)
WHERE stripe_connect_account_id<>'';

ALTER TABLE breaker_auction_payments ADD COLUMN stripe_connect_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE breaker_auction_payments ADD COLUMN platform_commission_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breaker_auction_payments ADD COLUMN processing_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breaker_auction_payments ADD COLUMN application_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breaker_auction_payments ADD COLUMN seller_proceeds_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breaker_auction_payments ADD COLUMN stripe_transfer_group TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS auction_bid_requests (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  bidder_member_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000),
  created_at TEXT NOT NULL,
  UNIQUE(lot_id,bidder_member_id,idempotency_key_hash),
  FOREIGN KEY(lot_id) REFERENCES breaker_auction_lots(id),
  FOREIGN KEY(bidder_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_auction_bid_requests_created
ON auction_bid_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_breaker_auction_bids_bidder_created
ON breaker_auction_bids(bidder_member_id,created_at DESC);

CREATE TABLE IF NOT EXISTS client_analytics_events (
  id TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  member_id TEXT,
  event_name TEXT NOT NULL CHECK(length(event_name) BETWEEN 2 AND 64),
  page_path TEXT NOT NULL DEFAULT '' CHECK(length(page_path) <= 180),
  metric_name TEXT NOT NULL DEFAULT '' CHECK(length(metric_name) <= 64),
  metric_value REAL,
  detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 300),
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_client_analytics_event_created
ON client_analytics_events(event_name,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_analytics_visitor_created
ON client_analytics_events(visitor_hash,created_at DESC);
