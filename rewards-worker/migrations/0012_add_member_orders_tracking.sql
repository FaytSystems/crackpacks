CREATE TABLE IF NOT EXISTS member_orders (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  order_number TEXT NOT NULL UNIQUE CHECK(length(order_number) BETWEEN 1 AND 64),
  channel TEXT NOT NULL CHECK(channel IN ('website','whatnot','manual')),
  items_json TEXT NOT NULL CHECK(length(items_json) BETWEEN 2 AND 10000),
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','shipped','delivered','cancelled')),
  placed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_member_orders_member_placed ON member_orders(member_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_orders_owner_updated ON member_orders(owner_member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  easypost_tracker_id TEXT NOT NULL UNIQUE CHECK(easypost_tracker_id LIKE 'trk_%'),
  mode TEXT NOT NULL CHECK(mode IN ('test','production')),
  carrier TEXT NOT NULL CHECK(length(carrier) BETWEEN 1 AND 60),
  tracking_code TEXT NOT NULL CHECK(length(tracking_code) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'unknown',
  status_detail TEXT NOT NULL DEFAULT '',
  estimated_delivery_date TEXT,
  carrier_public_url TEXT NOT NULL DEFAULT '',
  tracking_details_json TEXT NOT NULL DEFAULT '[]' CHECK(length(tracking_details_json) BETWEEN 2 AND 50000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_shipments_tracker ON order_shipments(easypost_tracker_id);
CREATE INDEX IF NOT EXISTS idx_order_shipments_code ON order_shipments(carrier, tracking_code);

CREATE TABLE IF NOT EXISTS easypost_webhook_events (
  event_id TEXT PRIMARY KEY,
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 100),
  mode TEXT NOT NULL CHECK(mode IN ('test','production')),
  tracker_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_easypost_webhook_received ON easypost_webhook_events(received_at DESC);
