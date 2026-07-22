CREATE TRIGGER IF NOT EXISTS trg_inventory_quantity_commitment_guard
BEFORE UPDATE OF quantity ON inventory_items
WHEN NEW.quantity < COALESCE((
  SELECT SUM(
    CASE
      WHEN campaign.is_active=1 AND campaign.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN
        MAX(campaign.max_redemptions - (
          SELECT COUNT(*) FROM campaign_redemptions fulfilled
          WHERE fulfilled.campaign_id=campaign.id AND fulfilled.redeemed_at IS NOT NULL
        ), 0)
      ELSE (
        SELECT COUNT(*) FROM campaign_redemptions promised
        WHERE promised.campaign_id=campaign.id AND promised.redeemed_at IS NULL
      )
    END
  )
  FROM offer_campaigns campaign
  WHERE campaign.inventory_item_id=OLD.id
),0)
BEGIN
  SELECT RAISE(ABORT,'INVENTORY_COMMITMENT_CONFLICT');
END;
