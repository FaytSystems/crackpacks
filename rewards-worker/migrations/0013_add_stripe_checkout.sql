ALTER TABLE shipping_quotes ADD COLUMN address_json TEXT NOT NULL DEFAULT '{}'
  CHECK(length(address_json) BETWEEN 2 AND 5000);

ALTER TABLE member_orders ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_cents >= 0);
ALTER TABLE member_orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK(shipping_cents >= 0);
ALTER TABLE member_orders ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_cents >= 0);
ALTER TABLE member_orders ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0);
ALTER TABLE member_orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3);
ALTER TABLE member_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK(payment_status IN ('not_applicable','paid','refund_pending','refunded','failed'));
ALTER TABLE member_orders ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE member_orders ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE member_orders ADD COLUMN shipping_address_json TEXT NOT NULL DEFAULT '{}'
  CHECK(length(shipping_address_json) BETWEEN 2 AND 5000);
ALTER TABLE member_orders ADD COLUMN shipping_service TEXT NOT NULL DEFAULT '' CHECK(length(shipping_service) <= 140);
ALTER TABLE member_orders ADD COLUMN stripe_refund_id TEXT;
ALTER TABLE member_orders ADD COLUMN refunded_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_orders_stripe_session
ON member_orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_orders_payment_intent
ON member_orders(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkout_reservations (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  shipping_quote_id TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 2 AND 120),
  unit_amount_cents INTEGER NOT NULL CHECK(unit_amount_cents >= 0),
  shipping_amount_cents INTEGER NOT NULL CHECK(shipping_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
  easypost_shipment_id TEXT NOT NULL CHECK(length(easypost_shipment_id) BETWEEN 4 AND 100),
  easypost_rate_id TEXT NOT NULL CHECK(length(easypost_rate_id) BETWEEN 4 AND 100),
  carrier TEXT NOT NULL CHECK(length(carrier) BETWEEN 1 AND 60),
  service TEXT NOT NULL CHECK(length(service) BETWEEN 1 AND 80),
  address_json TEXT NOT NULL CHECK(length(address_json) BETWEEN 2 AND 5000),
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK(status IN ('creating','open','paid','expired','cancelled','refunded','failed')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  order_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY(shipping_quote_id) REFERENCES shipping_quotes(id),
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_reservations_member
ON checkout_reservations(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_reservations_status_expiry
ON checkout_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 100),
  livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_received
ON stripe_webhook_events(received_at DESC);

CREATE TABLE IF NOT EXISTS order_notification_events (
  event_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 80),
  sent_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_notification_order
ON order_notification_events(order_id, sent_at DESC);
