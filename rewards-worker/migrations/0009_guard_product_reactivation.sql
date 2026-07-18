CREATE TRIGGER IF NOT EXISTS trg_product_campaign_reactivation_guard
BEFORE UPDATE OF is_active ON offer_campaigns
WHEN NEW.is_active=1 AND OLD.is_active=0 AND NEW.inventory_item_id IS NOT NULL
  AND (
    COALESCE((SELECT inventory.is_active FROM inventory_items inventory WHERE inventory.id=NEW.inventory_item_id),0)<>1
    OR COALESCE((SELECT inventory.quantity FROM inventory_items inventory WHERE inventory.id=NEW.inventory_item_id),-1) <
      COALESCE((
        SELECT SUM(
          CASE
            WHEN other.is_active=1 AND other.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN
              MAX(other.max_redemptions - (
                SELECT COUNT(*) FROM campaign_redemptions fulfilled
                WHERE fulfilled.campaign_id=other.id AND fulfilled.redeemed_at IS NOT NULL
              ), 0)
            ELSE (
              SELECT COUNT(*) FROM campaign_redemptions promised
              WHERE promised.campaign_id=other.id AND promised.redeemed_at IS NULL
            )
          END
        )
        FROM offer_campaigns other
        WHERE other.inventory_item_id=NEW.inventory_item_id AND other.id<>NEW.id
      ),0)
      + CASE
          WHEN NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN
            MAX(NEW.max_redemptions - (
              SELECT COUNT(*) FROM campaign_redemptions fulfilled
              WHERE fulfilled.campaign_id=NEW.id AND fulfilled.redeemed_at IS NOT NULL
            ), 0)
          ELSE (
            SELECT COUNT(*) FROM campaign_redemptions promised
            WHERE promised.campaign_id=NEW.id AND promised.redeemed_at IS NULL
          )
        END
  )
BEGIN
  SELECT RAISE(ABORT,'INVENTORY_COMMITMENT_CONFLICT');
END;
