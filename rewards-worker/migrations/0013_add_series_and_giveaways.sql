ALTER TABLE inventory_items ADD COLUMN series TEXT NOT NULL DEFAULT 'pokemon' CHECK(series IN ('pokemon','magic'));

CREATE TABLE IF NOT EXISTS seller_giveaways (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  show_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
  inventory_label TEXT NOT NULL CHECK(length(inventory_label) BETWEEN 1 AND 100),
  eligibility_profile TEXT NOT NULL DEFAULT '' CHECK(length(eligibility_profile) <= 100),
  open_mode TEXT NOT NULL DEFAULT '' CHECK(length(open_mode) <= 100),
  rules TEXT NOT NULL DEFAULT '' CHECK(length(rules) <= 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','open','closed','drawn','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_giveaways_owner_updated ON seller_giveaways(owner_member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS gifted_giveaways (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  giver_member_id TEXT,
  show_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','reserved','queued','launched','fulfilled','cancelled','refunded')),
  inventory_item_id TEXT,
  reserved_units INTEGER NOT NULL DEFAULT 0 CHECK(reserved_units BETWEEN 0 AND 50),
  payment_reference TEXT NOT NULL DEFAULT '' CHECK(length(payment_reference) <= 120),
  message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(giver_member_id) REFERENCES members(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_gifted_giveaways_owner_updated ON gifted_giveaways(owner_member_id, updated_at DESC);
