ALTER TABLE breaker_inventory_items ADD COLUMN product_category_key TEXT NOT NULL DEFAULT 'tcg' CHECK(length(product_category_key) <= 64);

ALTER TABLE breaker_inventory_items ADD COLUMN shipping_weight_profile_id TEXT;

ALTER TABLE seller_store_listings ADD COLUMN product_category_key TEXT NOT NULL DEFAULT 'tcg' CHECK(length(product_category_key) <= 64);

ALTER TABLE seller_store_listings ADD COLUMN shipping_weight_profile_id TEXT;

ALTER TABLE seller_store_listings ADD COLUMN fixed_shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK(fixed_shipping_cents BETWEEN 0 AND 10000000);

ALTER TABLE seller_store_listings ADD COLUMN shipping_overage_policy TEXT NOT NULL DEFAULT 'seller_pays_difference' CHECK(shipping_overage_policy IN ('seller_pays_difference'));

CREATE TABLE IF NOT EXISTS seller_product_categories (
  member_id TEXT NOT NULL,
  category_key TEXT NOT NULL CHECK(length(category_key) BETWEEN 2 AND 64),
  category_label TEXT NOT NULL CHECK(length(category_label) BETWEEN 2 AND 80),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id, category_key),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_product_categories_enabled
  ON seller_product_categories(category_key, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS seller_shipping_weight_profiles (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  product_category_key TEXT NOT NULL DEFAULT '' CHECK(length(product_category_key) <= 64),
  breaker_inventory_item_id TEXT,
  weight_unit_system TEXT NOT NULL DEFAULT 'imperial' CHECK(weight_unit_system IN ('imperial','metric')),
  display_weight_value REAL NOT NULL CHECK(display_weight_value > 0),
  display_weight_unit TEXT NOT NULL DEFAULT 'oz' CHECK(display_weight_unit IN ('oz','lb','g','kg')),
  final_weight_oz REAL NOT NULL CHECK(final_weight_oz > 0 AND final_weight_oz <= 2400),
  length_in REAL CHECK(length_in IS NULL OR (length_in > 0 AND length_in <= 120)),
  width_in REAL CHECK(width_in IS NULL OR (width_in > 0 AND width_in <= 120)),
  height_in REAL CHECK(height_in IS NULL OR (height_in > 0 AND height_in <= 120)),
  packaging_note TEXT NOT NULL DEFAULT '' CHECK(length(packaging_note) <= 300),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(breaker_inventory_item_id) REFERENCES breaker_inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_weight_profiles_member_updated
  ON seller_shipping_weight_profiles(member_id, updated_at DESC);
