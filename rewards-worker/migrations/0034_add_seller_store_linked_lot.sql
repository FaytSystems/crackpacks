ALTER TABLE seller_store_listings ADD COLUMN linked_lot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_seller_store_listings_linked_lot ON seller_store_listings(linked_lot_id);
