CREATE TABLE seller_store_listings__new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  show_id TEXT,
  inventory_item_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  sale_type TEXT NOT NULL DEFAULT 'sealed' CHECK(sale_type IN ('cards','breaks','singles','sealed','rip_ship','rtyh','buy_ship')),
  item_condition TEXT NOT NULL DEFAULT '' CHECK(length(item_condition) <= 80),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 0 AND 100000),
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),
  image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','sold_out')),
  shipping_payer TEXT NOT NULL DEFAULT 'buyer' CHECK(shipping_payer IN ('buyer','seller')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(show_id) REFERENCES breaker_stream_sessions(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);

INSERT INTO seller_store_listings__new (
  id,member_id,show_id,inventory_item_id,title,description,sale_type,item_condition,quantity,price_cents,image_url,status,shipping_payer,created_at,updated_at
)
SELECT
  id,
  member_id,
  NULLIF(show_id, ''),
  inventory_item_id,
  title,
  description,
  sale_type,
  item_condition,
  quantity,
  price_cents,
  image_url,
  status,
  COALESCE(shipping_payer, 'buyer'),
  created_at,
  updated_at
FROM seller_store_listings;

DROP TABLE seller_store_listings;
ALTER TABLE seller_store_listings__new RENAME TO seller_store_listings;

CREATE INDEX IF NOT EXISTS idx_seller_store_listings_member_updated ON seller_store_listings(member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_store_listings_status_updated ON seller_store_listings(status, updated_at DESC);
