-- Gifted giveaways reserve stock from a seller's breaker inventory, not from
-- the owner's public store inventory. Keep the legacy inventory_item_id column
-- for already-created owner-managed gifts and record new paid gifts here.
ALTER TABLE gifted_giveaways ADD COLUMN breaker_inventory_item_id TEXT REFERENCES breaker_inventory_items(id);

CREATE INDEX IF NOT EXISTS idx_gifted_breaker_inventory
  ON gifted_giveaways(breaker_inventory_item_id)
  WHERE breaker_inventory_item_id IS NOT NULL;
