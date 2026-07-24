ALTER TABLE seller_shipping_weight_profiles
  ADD COLUMN auto_label_purchase_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_label_purchase_enabled IN (0,1));
