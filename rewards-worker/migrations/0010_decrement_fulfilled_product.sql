CREATE TRIGGER IF NOT EXISTS trg_product_redemption_decrements_inventory
AFTER UPDATE OF redeemed_at ON campaign_redemptions
WHEN OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL
  AND EXISTS(
    SELECT 1 FROM offer_campaigns campaign
    WHERE campaign.id=NEW.campaign_id AND campaign.inventory_item_id IS NOT NULL
  )
BEGIN
  UPDATE inventory_items
  SET quantity=CASE WHEN quantity>0 THEN quantity-1 ELSE RAISE(ABORT,'PRODUCT_STOCK_UNAVAILABLE') END,
      updated_at=NEW.redeemed_at
  WHERE id=(SELECT inventory_item_id FROM offer_campaigns WHERE id=NEW.campaign_id);
END;
