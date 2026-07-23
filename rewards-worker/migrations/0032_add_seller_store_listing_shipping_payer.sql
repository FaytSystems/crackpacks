ALTER TABLE seller_store_listings ADD COLUMN shipping_payer TEXT NOT NULL DEFAULT 'buyer' CHECK(shipping_payer IN ('buyer','seller'));
