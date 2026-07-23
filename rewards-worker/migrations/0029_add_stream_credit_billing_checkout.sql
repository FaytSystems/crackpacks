ALTER TABLE seller_stream_subscriptions ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE seller_stream_subscriptions ADD COLUMN stripe_subscription_status TEXT NOT NULL DEFAULT '';
ALTER TABLE seller_stream_subscriptions ADD COLUMN stripe_current_period_end TEXT;
ALTER TABLE seller_stream_subscriptions ADD COLUMN stripe_last_invoice_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS seller_stream_checkout_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('subscription','prepaid_credits')),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL DEFAULT '',
  selected_plan_code TEXT NOT NULL DEFAULT '',
  selected_plan_name TEXT NOT NULL DEFAULT '',
  credit_quantity REAL NOT NULL DEFAULT 0,
  total_amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','expired','failed')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_checkout_sessions_member ON seller_stream_checkout_sessions(member_id, created_at DESC);
