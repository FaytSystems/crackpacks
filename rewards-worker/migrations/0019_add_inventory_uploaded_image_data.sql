ALTER TABLE inventory_items ADD COLUMN image_data_url TEXT NOT NULL DEFAULT '' CHECK(length(image_data_url) <= 240000);
