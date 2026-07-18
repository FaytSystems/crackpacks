PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified_at TEXT,
  first_name TEXT, last_name TEXT, birth_date TEXT, whatnot_username TEXT UNIQUE,
  identity_fingerprint TEXT UNIQUE, identity_status TEXT NOT NULL DEFAULT 'pending',
  device_verified INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL UNIQUE, referred_by_member_id TEXT,
  referral_qualified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(referred_by_member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL,
  auth_flow TEXT NOT NULL DEFAULT 'legacy', referrer_member_id TEXT,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, inviter_member_id TEXT NOT NULL, invitee_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', created_at TEXT NOT NULL,
  UNIQUE(inviter_member_id, invitee_email), FOREIGN KEY(inviter_member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS discount_claims (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
  percent INTEGER NOT NULL, expires_at TEXT NOT NULL, redemption_requested_at TEXT, redeemed_at TEXT, redeemed_by_member_id TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE CHECK(length(public_slug) BETWEEN 4 AND 160),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  upc TEXT CHECK(upc IS NULL OR (length(upc) BETWEEN 6 AND 18 AND upc NOT GLOB '*[^0-9]*')),
  category TEXT NOT NULL DEFAULT '' CHECK(length(category) <= 64),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  image_url TEXT NOT NULL DEFAULT '' CHECK(length(image_url) <= 500),
  source_url TEXT NOT NULL DEFAULT '' CHECK(length(source_url) <= 500),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000),
  average_msrp_cents INTEGER CHECK(average_msrp_cents IS NULL OR average_msrp_cents BETWEEN 0 AND 100000000),
  reference_price_label TEXT NOT NULL DEFAULT 'Retail reference price' CHECK(length(reference_price_label) <= 80),
  reference_price_observed_at TEXT,
  cogs_cents INTEGER CHECK(cogs_cents IS NULL OR cogs_cents BETWEEN 0 AND 100000000),
  us_shipping_cents INTEGER CHECK(us_shipping_cents IS NULL OR us_shipping_cents BETWEEN 0 AND 10000000),
  profit_cents INTEGER NOT NULL DEFAULT 1000 CHECK(profit_cents BETWEEN 0 AND 10000000),
  packaging_cents INTEGER CHECK(packaging_cents IS NULL OR packaging_cents BETWEEN 0 AND 10000000),
  overhead_cents INTEGER CHECK(overhead_cents IS NULL OR overhead_cents BETWEEN 0 AND 10000000),
  retail_fixed_fee_cents INTEGER CHECK(retail_fixed_fee_cents IS NULL OR retail_fixed_fee_cents BETWEEN 0 AND 10000000),
  wholesale_handling_cents INTEGER CHECK(wholesale_handling_cents IS NULL OR wholesale_handling_cents BETWEEN 0 AND 10000000),
  retail_list_price_cents INTEGER CHECK(retail_list_price_cents IS NULL OR retail_list_price_cents BETWEEN 0 AND 100000000),
  website_list_price_cents INTEGER CHECK(website_list_price_cents IS NULL OR website_list_price_cents BETWEEN 0 AND 100000000),
  international_list_price_cents INTEGER CHECK(international_list_price_cents IS NULL OR international_list_price_cents BETWEEN 0 AND 100000000),
  whatnot_list_price_cents INTEGER CHECK(whatnot_list_price_cents IS NULL OR whatnot_list_price_cents BETWEEN 0 AND 100000000),
  wholesale_small_list_price_cents INTEGER CHECK(wholesale_small_list_price_cents IS NULL OR wholesale_small_list_price_cents BETWEEN 0 AND 100000000),
  wholesale_case_list_price_cents INTEGER CHECK(wholesale_case_list_price_cents IS NULL OR wholesale_case_list_price_cents BETWEEN 0 AND 100000000),
  wholesale_pallet_list_price_cents INTEGER CHECK(wholesale_pallet_list_price_cents IS NULL OR wholesale_pallet_list_price_cents BETWEEN 0 AND 100000000),
  weight_oz REAL CHECK(weight_oz IS NULL OR (weight_oz > 0 AND weight_oz <= 2400)),
  length_in REAL CHECK(length_in IS NULL OR (length_in > 0 AND length_in <= 120)),
  width_in REAL CHECK(width_in IS NULL OR (width_in > 0 AND width_in <= 120)),
  height_in REAL CHECK(height_in IS NULL OR (height_in > 0 AND height_in <= 120)),
  origin_country TEXT NOT NULL DEFAULT '' CHECK(length(origin_country) <= 2),
  hs_code TEXT NOT NULL DEFAULT '' CHECK(length(hs_code) <= 12),
  packing_notes TEXT NOT NULL DEFAULT '' CHECK(length(packing_notes) <= 500),
  is_store_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_store_visible IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_member_id, upc),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_owner_name ON inventory_items(owner_member_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_inventory_items_owner_upc ON inventory_items(owner_member_id, upc);
CREATE INDEX IF NOT EXISTS idx_inventory_items_public_store ON inventory_items(is_store_visible, is_active, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_owner_source ON inventory_items(owner_member_id, source_url) WHERE source_url <> '';
CREATE TABLE IF NOT EXISTS offer_campaigns (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  reward_type TEXT NOT NULL CHECK(reward_type IN ('percent','free_shipping','pick_a_pack','pack_draft')),
  reward_variant TEXT CHECK(reward_variant IS NULL OR (reward_variant = 'free_single' AND reward_type = 'pick_a_pack')),
  percent INTEGER,
  max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 500),
  pack_count INTEGER,
  offer_token TEXT NOT NULL UNIQUE CHECK(length(offer_token) BETWEEN 20 AND 80),
  expires_at TEXT NOT NULL,
  never_expires INTEGER NOT NULL DEFAULT 0 CHECK(never_expires IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  inventory_item_id TEXT,
  product_name_snapshot TEXT CHECK(product_name_snapshot IS NULL OR length(product_name_snapshot) BETWEEN 2 AND 120),
  product_upc_snapshot TEXT CHECK(product_upc_snapshot IS NULL OR (length(product_upc_snapshot) BETWEEN 6 AND 18 AND product_upc_snapshot NOT GLOB '*[^0-9]*')),
  created_at TEXT NOT NULL,
  CHECK(expires_at > created_at),
  CHECK(
    (reward_type = 'percent' AND percent IS NOT NULL AND percent BETWEEN 1 AND 100 AND pack_count IS NULL) OR
    (reward_type = 'pack_draft' AND percent IS NULL AND pack_count IS NOT NULL AND pack_count BETWEEN max_redemptions AND 500) OR
    (reward_type IN ('free_shipping','pick_a_pack') AND percent IS NULL AND pack_count IS NULL)
  ),
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_offer_campaigns_created ON offer_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_campaigns_expires ON offer_campaigns(expires_at);
CREATE INDEX IF NOT EXISTS idx_offer_campaigns_inventory_item ON offer_campaigns(inventory_item_id);
CREATE TABLE IF NOT EXISTS shipping_quotes (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  market TEXT NOT NULL CHECK(market IN ('us','international')),
  destination_country TEXT NOT NULL CHECK(length(destination_country) = 2),
  address_hash TEXT NOT NULL,
  address_json TEXT NOT NULL DEFAULT '{}' CHECK(length(address_json) BETWEEN 2 AND 5000),
  easypost_shipment_id TEXT NOT NULL,
  rates_json TEXT NOT NULL CHECK(length(rates_json) BETWEEN 2 AND 30000),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_expires ON shipping_quotes(expires_at);
CREATE TABLE IF NOT EXISTS owner_referral_controls (
  owner_member_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_member_id, slot_id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_owner_referral_controls_updated ON owner_referral_controls(updated_at DESC);
CREATE TABLE IF NOT EXISTS campaign_redemptions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  week_key TEXT NOT NULL CHECK(length(week_key) = 10),
  code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 6 AND 64),
  claim_rank INTEGER NOT NULL CHECK(claim_rank BETWEEN 1 AND 500),
  pack_number INTEGER CHECK(pack_number IS NULL OR pack_number BETWEEN 1 AND 500),
  claimed_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by_member_id TEXT,
  UNIQUE(campaign_id, member_id),
  UNIQUE(member_id, week_key),
  UNIQUE(campaign_id, claim_rank),
  UNIQUE(campaign_id, pack_number),
  FOREIGN KEY(campaign_id) REFERENCES offer_campaigns(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(redeemed_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_redemptions_campaign ON campaign_redemptions(campaign_id, claim_rank);
CREATE INDEX IF NOT EXISTS idx_campaign_redemptions_member ON campaign_redemptions(member_id, claimed_at DESC);
CREATE TABLE IF NOT EXISTS weekly_reward_claims (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  week_key TEXT NOT NULL CHECK(length(week_key) = 10),
  source_type TEXT NOT NULL CHECK(source_type IN ('campaign','legacy_discount')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(member_id, week_key),
  UNIQUE(source_type, source_id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_reward_claims_source ON weekly_reward_claims(source_type, source_id);
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0, transports TEXT, device_type TEXT, backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_used_at TEXT, FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_webauthn_member ON webauthn_credentials(member_id);
CREATE TABLE IF NOT EXISTS security_challenges (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL, purpose TEXT NOT NULL, challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, member_id TEXT, type TEXT NOT NULL, ip_hash TEXT, detail TEXT, created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS member_orders (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  order_number TEXT NOT NULL UNIQUE CHECK(length(order_number) BETWEEN 1 AND 64),
  channel TEXT NOT NULL CHECK(channel IN ('website','whatnot','manual')),
  items_json TEXT NOT NULL CHECK(length(items_json) BETWEEN 2 AND 10000),
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','shipped','delivered','cancelled')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK(shipping_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
  payment_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(payment_status IN ('not_applicable','paid','refund_pending','refunded','failed')),
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  shipping_address_json TEXT NOT NULL DEFAULT '{}' CHECK(length(shipping_address_json) BETWEEN 2 AND 5000),
  shipping_service TEXT NOT NULL DEFAULT '' CHECK(length(shipping_service) <= 140),
  stripe_refund_id TEXT,
  refunded_at TEXT,
  placed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_member_orders_member_placed ON member_orders(member_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_orders_owner_updated ON member_orders(owner_member_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_orders_stripe_session ON member_orders(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_orders_payment_intent ON member_orders(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkout_reservations (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  owner_member_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  shipping_quote_id TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 2 AND 120),
  unit_amount_cents INTEGER NOT NULL CHECK(unit_amount_cents >= 0),
  shipping_amount_cents INTEGER NOT NULL CHECK(shipping_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(length(currency) = 3),
  easypost_shipment_id TEXT NOT NULL CHECK(length(easypost_shipment_id) BETWEEN 4 AND 100),
  easypost_rate_id TEXT NOT NULL CHECK(length(easypost_rate_id) BETWEEN 4 AND 100),
  carrier TEXT NOT NULL CHECK(length(carrier) BETWEEN 1 AND 60),
  service TEXT NOT NULL CHECK(length(service) BETWEEN 1 AND 80),
  address_json TEXT NOT NULL CHECK(length(address_json) BETWEEN 2 AND 5000),
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','open','paid','expired','cancelled','refunded','failed')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  order_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY(shipping_quote_id) REFERENCES shipping_quotes(id),
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_checkout_reservations_member ON checkout_reservations(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_reservations_status_expiry ON checkout_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 100),
  livemode INTEGER NOT NULL CHECK(livemode IN (0,1)),
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_received ON stripe_webhook_events(received_at DESC);

CREATE TABLE IF NOT EXISTS order_notification_events (
  event_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 80),
  sent_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_notification_order ON order_notification_events(order_id, sent_at DESC);
CREATE TABLE IF NOT EXISTS order_shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  easypost_tracker_id TEXT NOT NULL UNIQUE CHECK(easypost_tracker_id LIKE 'trk_%'),
  mode TEXT NOT NULL CHECK(mode IN ('test','production')),
  carrier TEXT NOT NULL CHECK(length(carrier) BETWEEN 1 AND 60),
  tracking_code TEXT NOT NULL CHECK(length(tracking_code) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'unknown',
  status_detail TEXT NOT NULL DEFAULT '',
  estimated_delivery_date TEXT,
  carrier_public_url TEXT NOT NULL DEFAULT '',
  tracking_details_json TEXT NOT NULL DEFAULT '[]' CHECK(length(tracking_details_json) BETWEEN 2 AND 50000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES member_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_shipments_tracker ON order_shipments(easypost_tracker_id);
CREATE INDEX IF NOT EXISTS idx_order_shipments_code ON order_shipments(carrier, tracking_code);
CREATE TABLE IF NOT EXISTS easypost_webhook_events (
  event_id TEXT PRIMARY KEY,
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 100),
  mode TEXT NOT NULL CHECK(mode IN ('test','production')),
  tracker_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_easypost_webhook_received ON easypost_webhook_events(received_at DESC);
