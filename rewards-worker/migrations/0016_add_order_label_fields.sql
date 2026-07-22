ALTER TABLE order_shipments ADD COLUMN easypost_shipment_id TEXT CHECK(easypost_shipment_id IS NULL OR easypost_shipment_id LIKE 'shp_%');
ALTER TABLE order_shipments ADD COLUMN easypost_rate_id TEXT CHECK(easypost_rate_id IS NULL OR easypost_rate_id LIKE 'rate_%');
ALTER TABLE order_shipments ADD COLUMN postage_label_url TEXT NOT NULL DEFAULT '' CHECK(length(postage_label_url) <= 500);
ALTER TABLE order_shipments ADD COLUMN postage_label_pdf_url TEXT NOT NULL DEFAULT '' CHECK(length(postage_label_pdf_url) <= 500);
ALTER TABLE order_shipments ADD COLUMN label_file_type TEXT NOT NULL DEFAULT '' CHECK(length(label_file_type) <= 20);
ALTER TABLE order_shipments ADD COLUMN label_rate_cents INTEGER CHECK(label_rate_cents IS NULL OR label_rate_cents >= 0);
ALTER TABLE order_shipments ADD COLUMN label_purchased_at TEXT;
