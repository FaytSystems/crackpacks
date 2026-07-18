CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE CHECK(length(public_slug) BETWEEN 4 AND 160),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  upc TEXT CHECK(upc IS NULL OR (length(upc) BETWEEN 6 AND 18 AND upc NOT GLOB '*[^0-9]*')),
  category TEXT NOT NULL DEFAULT '' CHECK(length(category) <= 64),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 500),
  source_url TEXT NOT NULL DEFAULT '' CHECK(length(source_url) <= 500),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000),
  average_msrp_cents INTEGER CHECK(average_msrp_cents IS NULL OR average_msrp_cents BETWEEN 0 AND 100000000),
  reference_price_label TEXT NOT NULL DEFAULT 'Retail reference price' CHECK(length(reference_price_label) <= 80),
  reference_price_observed_at TEXT,
  cogs_cents INTEGER CHECK(cogs_cents IS NULL OR cogs_cents BETWEEN 0 AND 100000000),
  us_shipping_cents INTEGER CHECK(us_shipping_cents IS NULL OR us_shipping_cents BETWEEN 0 AND 10000000),
  profit_cents INTEGER NOT NULL DEFAULT 1000 CHECK(profit_cents BETWEEN 0 AND 10000000),
  weight_oz REAL CHECK(weight_oz IS NULL OR (weight_oz > 0 AND weight_oz <= 2400)),
  length_in REAL CHECK(length_in IS NULL OR (length_in > 0 AND length_in <= 120)),
  width_in REAL CHECK(width_in IS NULL OR (width_in > 0 AND width_in <= 120)),
  height_in REAL CHECK(height_in IS NULL OR (height_in > 0 AND height_in <= 120)),
  origin_country TEXT NOT NULL DEFAULT '' CHECK(length(origin_country) <= 2),
  hs_code TEXT NOT NULL DEFAULT '' CHECK(length(hs_code) <= 12),
  packing_notes TEXT NOT NULL DEFAULT '' CHECK(length(packing_notes) <= 500),
  is_store_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_store_visible IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_member_id, upc),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_owner_name
ON inventory_items(owner_member_id, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_inventory_items_owner_upc
ON inventory_items(owner_member_id, upc);

CREATE INDEX IF NOT EXISTS idx_inventory_items_public_store
ON inventory_items(is_store_visible, is_active, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_owner_source
ON inventory_items(owner_member_id, source_url)
WHERE source_url <> '';

ALTER TABLE offer_campaigns
ADD COLUMN inventory_item_id TEXT REFERENCES inventory_items(id);

ALTER TABLE offer_campaigns
ADD COLUMN product_name_snapshot TEXT
CHECK(product_name_snapshot IS NULL OR length(product_name_snapshot) BETWEEN 2 AND 120);

ALTER TABLE offer_campaigns
ADD COLUMN product_upc_snapshot TEXT
CHECK(product_upc_snapshot IS NULL OR (length(product_upc_snapshot) BETWEEN 6 AND 18 AND product_upc_snapshot NOT GLOB '*[^0-9]*'));

CREATE INDEX IF NOT EXISTS idx_offer_campaigns_inventory_item
ON offer_campaigns(inventory_item_id);

CREATE TABLE IF NOT EXISTS shipping_quotes (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  market TEXT NOT NULL CHECK(market IN ('us','international')),
  destination_country TEXT NOT NULL CHECK(length(destination_country) = 2),
  address_hash TEXT NOT NULL,
  easypost_shipment_id TEXT NOT NULL,
  rates_json TEXT NOT NULL CHECK(length(rates_json) BETWEEN 2 AND 30000),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);

CREATE INDEX IF NOT EXISTS idx_shipping_quotes_expires
ON shipping_quotes(expires_at);
