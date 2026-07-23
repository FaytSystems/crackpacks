CREATE TABLE IF NOT EXISTS seller_store_listings (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  show_id TEXT NOT NULL DEFAULT '',
  inventory_item_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  sale_type TEXT NOT NULL DEFAULT 'sealed' CHECK(sale_type IN ('cards','breaks','singles','sealed','rip_ship','rtyh','buy_ship')),
  item_condition TEXT NOT NULL DEFAULT '' CHECK(length(item_condition) <= 80),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 0 AND 100000),
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),
  image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','sold_out')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(show_id) REFERENCES breaker_stream_sessions(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);

CREATE INDEX IF NOT EXISTS idx_seller_store_listings_member_updated ON seller_store_listings(member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_store_listings_status_updated ON seller_store_listings(status, updated_at DESC);
