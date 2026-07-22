CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_owner_sku ON inventory_items(owner_member_id, sku) WHERE sku <> '';

CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  order_id TEXT,
  reservation_id TEXT,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('manual_set','manual_add','reserved','released','refunded','correction')),
  delta_quantity INTEGER NOT NULL CHECK(delta_quantity BETWEEN -100000 AND 100000),
  resulting_quantity INTEGER CHECK(resulting_quantity IS NULL OR resulting_quantity BETWEEN 0 AND 100000),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
  created_at TEXT NOT NULL,
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(order_id) REFERENCES member_orders(id),
  FOREIGN KEY(reservation_id) REFERENCES checkout_reservations(id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_movements_item_created ON inventory_stock_movements(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_movements_owner_created ON inventory_stock_movements(owner_member_id, created_at DESC);
