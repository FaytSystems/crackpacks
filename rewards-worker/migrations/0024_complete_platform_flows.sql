ALTER TABLE members ADD COLUMN live_username TEXT;
ALTER TABLE members ADD COLUMN live_username_key TEXT;
ALTER TABLE members ADD COLUMN phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 32);
ALTER TABLE members ADD COLUMN shipping_address_json TEXT NOT NULL DEFAULT '{}' CHECK(length(shipping_address_json) BETWEEN 2 AND 5000);
ALTER TABLE members ADD COLUMN stripe_customer_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_customer_id) <= 120);
ALTER TABLE members ADD COLUMN stripe_identity_session_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_identity_session_id) <= 120);
ALTER TABLE members ADD COLUMN stripe_identity_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK(stripe_identity_status IN ('not_started','requires_input','processing','verified','cancelled','redacted','failed','manual_review'));
ALTER TABLE members ADD COLUMN active_portal TEXT NOT NULL DEFAULT 'buyer' CHECK(active_portal IN ('buyer','seller'));
ALTER TABLE inventory_items ADD COLUMN live_list_price_cents INTEGER CHECK(live_list_price_cents IS NULL OR live_list_price_cents BETWEEN 0 AND 100000000);

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_live_username ON members(live_username) WHERE live_username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_live_username_key ON members(live_username_key) WHERE live_username_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_stripe_identity_session ON members(stripe_identity_session_id) WHERE stripe_identity_session_id <> '';

CREATE TABLE IF NOT EXISTS identity_review_queue (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  conflicting_member_id TEXT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 500),
  reviewed_by_member_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(conflicting_member_id) REFERENCES members(id),
  FOREIGN KEY(reviewed_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_identity_review_status_created ON identity_review_queue(status, created_at DESC);

ALTER TABLE gifted_giveaways ADD COLUMN unit_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_amount_cents >= 0);
ALTER TABLE gifted_giveaways ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3);
ALTER TABLE gifted_giveaways ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE gifted_giveaways ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE gifted_giveaways ADD COLUMN expires_at TEXT;
ALTER TABLE gifted_giveaways ADD COLUMN paid_at TEXT;
ALTER TABLE gifted_giveaways ADD COLUMN refunded_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gifted_checkout_session ON gifted_giveaways(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gifted_payment_intent ON gifted_giveaways(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stream_watchlists (
  member_id TEXT NOT NULL,
  stream_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(member_id, stream_session_id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(stream_session_id) REFERENCES breaker_stream_sessions(id)
);

CREATE TABLE IF NOT EXISTS stream_follows (
  follower_member_id TEXT NOT NULL,
  seller_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(follower_member_id, seller_member_id),
  FOREIGN KEY(follower_member_id) REFERENCES members(id),
  FOREIGN KEY(seller_member_id) REFERENCES members(id)
);

ALTER TABLE breaker_stream_sessions ADD COLUMN public_slug TEXT NOT NULL DEFAULT '' CHECK(length(public_slug) <= 120);
ALTER TABLE breaker_stream_sessions ADD COLUMN scheduled_at TEXT;
ALTER TABLE breaker_stream_sessions ADD COLUMN thumbnail_url TEXT NOT NULL DEFAULT '' CHECK(length(thumbnail_url) <= 500);
ALTER TABLE breaker_stream_sessions ADD COLUMN viewer_count INTEGER NOT NULL DEFAULT 0 CHECK(viewer_count >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_breaker_stream_public_slug ON breaker_stream_sessions(public_slug) WHERE public_slug <> '';

ALTER TABLE breaker_auction_lots ADD COLUMN image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 500);
ALTER TABLE breaker_auction_lots ADD COLUMN item_condition TEXT NOT NULL DEFAULT '' CHECK(length(item_condition) <= 80);
ALTER TABLE breaker_auction_lots ADD COLUMN sale_type TEXT NOT NULL DEFAULT 'sealed'
  CHECK(sale_type IN ('cards','breaks','singles','sealed','rip_ship','rtyh','buy_ship'));
ALTER TABLE breaker_auction_lots ADD COLUMN winner_banner_until TEXT;

CREATE TABLE IF NOT EXISTS platform_idempotency_keys (
  key TEXT PRIMARY KEY,
  member_id TEXT,
  operation TEXT NOT NULL CHECK(length(operation) BETWEEN 3 AND 80),
  resource_id TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
