CREATE TABLE IF NOT EXISTS breaker_profiles (
  member_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT '' CHECK(length(business_name) <= 100),
  status TEXT NOT NULL DEFAULT 'pending_activation' CHECK(status IN ('pending_activation','active','paused','suspended','rejected')),
  auto_reorder_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_reorder_enabled IN (0,1)),
  stripe_customer_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_customer_id) <= 120),
  bank_setup_intent_id TEXT NOT NULL DEFAULT '' CHECK(length(bank_setup_intent_id) <= 120),
  bank_payment_method_id TEXT NOT NULL DEFAULT '' CHECK(length(bank_payment_method_id) <= 120),
  bank_verification_status TEXT NOT NULL DEFAULT 'not_started' CHECK(bank_verification_status IN ('not_started','pending','requires_microdeposits','verified','locked','failed')),
  bank_verification_locked_until TEXT,
  bank_verification_failed_at TEXT,
  card_hold_payment_intent_id TEXT NOT NULL DEFAULT '' CHECK(length(card_hold_payment_intent_id) <= 120),
  card_hold_status TEXT NOT NULL DEFAULT 'not_started' CHECK(card_hold_status IN ('not_started','pending','verified','failed')),
  card_hold_verified_at TEXT,
  usage_alert_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK(usage_alert_email_enabled IN (0,1)),
  usage_alert_sms_enabled INTEGER NOT NULL DEFAULT 0 CHECK(usage_alert_sms_enabled IN (0,1)),
  alert_phone TEXT NOT NULL DEFAULT '' CHECK(length(alert_phone) <= 32),
  usage_alert_last_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS breaker_activation_codes (
  id TEXT PRIMARY KEY,
  target_email TEXT NOT NULL CHECK(length(target_email) BETWEEN 3 AND 254),
  target_member_id TEXT,
  code_hash TEXT NOT NULL UNIQUE,
  created_by_member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_member_id TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
  created_at TEXT NOT NULL,
  FOREIGN KEY(target_member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_member_id) REFERENCES members(id),
  FOREIGN KEY(used_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_activation_target_email ON breaker_activation_codes(target_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_activation_target_member ON breaker_activation_codes(target_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_activation_expires ON breaker_activation_codes(expires_at);

CREATE TABLE IF NOT EXISTS breaker_inventory_items (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  source_inventory_item_id TEXT,
  sku TEXT NOT NULL DEFAULT '' CHECK(length(sku) <= 64),
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 2 AND 160),
  unit_type TEXT NOT NULL DEFAULT 'sealed_box' CHECK(unit_type IN ('sealed_box','pack','single','supply')),
  packs_per_unit INTEGER CHECK(packs_per_unit IS NULL OR packs_per_unit BETWEEN 1 AND 500),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000),
  inbound_quantity INTEGER NOT NULL DEFAULT 0 CHECK(inbound_quantity BETWEEN 0 AND 100000),
  par_quantity INTEGER NOT NULL DEFAULT 0 CHECK(par_quantity BETWEEN 0 AND 100000),
  reorder_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reorder_quantity BETWEEN 0 AND 100000),
  auto_reorder_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_reorder_enabled IN (0,1)),
  pending_reorder_quantity INTEGER NOT NULL DEFAULT 0 CHECK(pending_reorder_quantity BETWEEN 0 AND 100000),
  sold_7d INTEGER NOT NULL DEFAULT 0 CHECK(sold_7d BETWEEN 0 AND 100000),
  sold_30d INTEGER NOT NULL DEFAULT 0 CHECK(sold_30d BETWEEN 0 AND 100000),
  last_sale_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(source_inventory_item_id) REFERENCES inventory_items(id),
  UNIQUE(member_id, source_inventory_item_id, unit_type)
);
CREATE INDEX IF NOT EXISTS idx_breaker_inventory_member_updated ON breaker_inventory_items(member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_inventory_source ON breaker_inventory_items(source_inventory_item_id);

CREATE TABLE IF NOT EXISTS breaker_inventory_movements (
  id TEXT PRIMARY KEY,
  breaker_inventory_item_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  source_order_id TEXT,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('manual_set','received','sale','break_packs_added','order_pending','reorder_requested','correction')),
  delta_quantity INTEGER NOT NULL CHECK(delta_quantity BETWEEN -100000 AND 100000),
  resulting_quantity INTEGER CHECK(resulting_quantity IS NULL OR resulting_quantity BETWEEN 0 AND 100000),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
  created_at TEXT NOT NULL,
  FOREIGN KEY(breaker_inventory_item_id) REFERENCES breaker_inventory_items(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(source_order_id) REFERENCES member_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_movements_item_created ON breaker_inventory_movements(breaker_inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_movements_member_created ON breaker_inventory_movements(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS breaker_sales (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  breaker_inventory_item_id TEXT NOT NULL,
  movement_id TEXT NOT NULL,
  buyer_email TEXT NOT NULL DEFAULT '' CHECK(length(buyer_email) <= 254),
  order_reference TEXT NOT NULL DEFAULT '' CHECK(length(order_reference) <= 120),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  sale_occurred_at TEXT NOT NULL,
  stream_started_at TEXT,
  stream_offset_seconds INTEGER CHECK(stream_offset_seconds IS NULL OR stream_offset_seconds BETWEEN 0 AND 86400),
  clip_started_at TEXT,
  clip_ended_at TEXT,
  clip_url TEXT NOT NULL DEFAULT '' CHECK(length(clip_url) <= 500),
  stream_recording_url TEXT NOT NULL DEFAULT '' CHECK(length(stream_recording_url) <= 500),
  buyer_verify_token_hash TEXT UNIQUE,
  buyer_verify_sent_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending_recording' CHECK(verification_status IN ('pending_recording','recording_attached','verified','disputed')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(breaker_inventory_item_id) REFERENCES breaker_inventory_items(id),
  FOREIGN KEY(movement_id) REFERENCES breaker_inventory_movements(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_sales_member_sale_time ON breaker_sales(member_id, sale_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_sales_item_sale_time ON breaker_sales(breaker_inventory_item_id, sale_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_sales_buyer ON breaker_sales(buyer_email, sale_occurred_at DESC);

CREATE TABLE IF NOT EXISTS breaker_reorder_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  breaker_inventory_item_id TEXT NOT NULL,
  source_inventory_item_id TEXT,
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 2 AND 160),
  unit_type TEXT NOT NULL CHECK(unit_type IN ('sealed_box','pack','single','supply')),
  requested_quantity INTEGER NOT NULL CHECK(requested_quantity BETWEEN 1 AND 100000),
  trigger_quantity INTEGER NOT NULL CHECK(trigger_quantity BETWEEN 0 AND 100000),
  par_quantity INTEGER NOT NULL CHECK(par_quantity BETWEEN 0 AND 100000),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','ordered','cancelled','rejected')),
  source TEXT NOT NULL DEFAULT 'auto_par' CHECK(length(source) <= 40),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  reviewed_by_member_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(breaker_inventory_item_id) REFERENCES breaker_inventory_items(id),
  FOREIGN KEY(source_inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY(reviewed_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_reorders_status_created ON breaker_reorder_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_reorders_member_created ON breaker_reorder_requests(member_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_breaker_reorders_one_pending ON breaker_reorder_requests(breaker_inventory_item_id) WHERE status IN ('pending_review','approved','ordered');
