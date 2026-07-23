PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified_at TEXT,
  first_name TEXT, last_name TEXT, birth_date TEXT, legacy_marketplace_username TEXT UNIQUE,
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
  series TEXT NOT NULL DEFAULT 'pokemon' CHECK(series IN ('pokemon','magic')),
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
  legacy_marketplace_list_price_cents INTEGER CHECK(legacy_marketplace_list_price_cents IS NULL OR legacy_marketplace_list_price_cents BETWEEN 0 AND 100000000),
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

CREATE TABLE IF NOT EXISTS seller_giveaways (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  show_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
  inventory_label TEXT NOT NULL CHECK(length(inventory_label) BETWEEN 1 AND 100),
  eligibility_profile TEXT NOT NULL DEFAULT '' CHECK(length(eligibility_profile) <= 100),
  open_mode TEXT NOT NULL DEFAULT '' CHECK(length(open_mode) <= 100),
  rules TEXT NOT NULL DEFAULT '' CHECK(length(rules) <= 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','open','closed','drawn','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_giveaways_owner_updated ON seller_giveaways(owner_member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS gifted_giveaways (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  giver_member_id TEXT,
  show_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','reserved','queued','launched','fulfilled','cancelled','refunded')),
  inventory_item_id TEXT,
  reserved_units INTEGER NOT NULL DEFAULT 0 CHECK(reserved_units BETWEEN 0 AND 50),
  payment_reference TEXT NOT NULL DEFAULT '' CHECK(length(payment_reference) <= 120),
  message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_member_id) REFERENCES members(id),
  FOREIGN KEY(giver_member_id) REFERENCES members(id),
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_gifted_giveaways_owner_updated ON gifted_giveaways(owner_member_id, updated_at DESC);

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
  channel TEXT NOT NULL CHECK(channel IN ('website','live','manual')),
  items_json TEXT NOT NULL CHECK(length(items_json) BETWEEN 2 AND 10000),
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','shipped','delivered','cancelled')),
  placed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_member_orders_member_placed ON member_orders(member_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_orders_owner_updated ON member_orders(owner_member_id, updated_at DESC);
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

CREATE TABLE IF NOT EXISTS stream_credit_config_versions (
  id TEXT PRIMARY KEY,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_member_id TEXT,
  delivery_minutes_per_credit REAL NOT NULL DEFAULT 1000,
  storage_minutes_per_credit REAL NOT NULL DEFAULT 200,
  replay_reserve_percentage REAL NOT NULL DEFAULT 0.10,
  safety_buffer_percentage REAL NOT NULL DEFAULT 0.20,
  recording_retention_days REAL NOT NULL DEFAULT 90,
  month_days REAL NOT NULL DEFAULT 30,
  stream_credit_underlying_value REAL NOT NULL DEFAULT 1,
  prepaid_extra_credit_price REAL NOT NULL DEFAULT 1.85,
  payg_overage_price REAL NOT NULL DEFAULT 2.25,
  unused_credit_rebate_rate REAL NOT NULL DEFAULT 1,
  finalization_delay_hours REAL NOT NULL DEFAULT 72,
  protected_evidence_reserve_credits REAL NOT NULL DEFAULT 5,
  auto_refill_package_sizes_json TEXT NOT NULL DEFAULT '[10,25,50,100]',
  spending_limit_default REAL NOT NULL DEFAULT 250,
  cash_out_threshold REAL NOT NULL DEFAULT 25,
  prepaid_credit_expiration_months REAL NOT NULL DEFAULT 12,
  stripe_domestic_rate REAL NOT NULL DEFAULT 0.029,
  stripe_domestic_fixed_fee REAL NOT NULL DEFAULT 0.30,
  cloudflare_credit_cost_assumption REAL NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_config_effective ON stream_credit_config_versions(effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS stream_credit_plan_versions (
  id TEXT PRIMARY KEY,
  plan_code TEXT NOT NULL CHECK(length(plan_code) BETWEEN 2 AND 32),
  plan_name TEXT NOT NULL CHECK(length(plan_name) BETWEEN 2 AND 60),
  monthly_price REAL,
  included_credits REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_member_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_plans_effective ON stream_credit_plan_versions(plan_code, effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_stream_subscriptions (
  member_id TEXT PRIMARY KEY,
  selected_plan_code TEXT NOT NULL DEFAULT 'starter',
  selected_plan_name TEXT NOT NULL DEFAULT 'Starter',
  monthly_price REAL,
  included_credits REAL NOT NULL DEFAULT 0,
  average_concurrent_viewers REAL NOT NULL DEFAULT 0,
  hours_per_show REAL NOT NULL DEFAULT 0,
  shows_per_month REAL NOT NULL DEFAULT 0,
  recording_retention_days REAL NOT NULL DEFAULT 90,
  replay_reserve_percentage REAL NOT NULL DEFAULT 0.10,
  safety_buffer_percentage REAL NOT NULL DEFAULT 0.20,
  expected_orders_per_show REAL,
  expected_growth_percentage REAL,
  desired_safety_buffer_percentage REAL,
  auto_refill_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_refill_enabled IN (0,1)),
  auto_refill_package_size REAL,
  auto_refill_trigger_balance REAL,
  auto_refill_monthly_spending_limit REAL,
  auto_refill_max_refills INTEGER,
  payg_enabled INTEGER NOT NULL DEFAULT 1 CHECK(payg_enabled IN (0,1)),
  payg_monthly_spending_limit REAL,
  prepaid_credits_balance REAL NOT NULL DEFAULT 0,
  pending_rebate_balance REAL NOT NULL DEFAULT 0,
  cash_out_eligible_balance REAL NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT,
  stripe_subscription_status TEXT NOT NULL DEFAULT '',
  stripe_current_period_end TEXT,
  stripe_last_invoice_id TEXT NOT NULL DEFAULT '',
  current_config_version_id TEXT,
  current_plan_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(current_config_version_id) REFERENCES stream_credit_config_versions(id),
  FOREIGN KEY(current_plan_version_id) REFERENCES stream_credit_plan_versions(id)
);

CREATE TABLE IF NOT EXISTS seller_stream_usage_snapshots (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  month_key TEXT NOT NULL CHECK(length(month_key) = 7),
  actual_live_viewer_minutes REAL NOT NULL DEFAULT 0,
  actual_replay_minutes REAL NOT NULL DEFAULT 0,
  actual_buyer_video_minutes REAL NOT NULL DEFAULT 0,
  actual_protected_evidence_minutes REAL NOT NULL DEFAULT 0,
  actual_delivered_minutes REAL NOT NULL DEFAULT 0,
  actual_recorded_minutes REAL NOT NULL DEFAULT 0,
  actual_stored_minutes REAL NOT NULL DEFAULT 0,
  finalized_credits_used REAL NOT NULL DEFAULT 0,
  projected_exhaustion_at TEXT,
  finalization_due_at TEXT,
  finalized_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','system','imported')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(member_id, month_key),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_usage_member_month ON seller_stream_usage_snapshots(member_id, month_key DESC);

CREATE TABLE IF NOT EXISTS seller_stream_credit_ledger (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  subscription_id TEXT,
  credit_source TEXT NOT NULL CHECK(credit_source IN ('monthly_included','prepaid_rollover','auto_refill','payg_overage','rebate','cash_out','admin_adjustment','refund','transfer')),
  credit_quantity REAL NOT NULL DEFAULT 0,
  dollar_value REAL NOT NULL DEFAULT 0,
  usage_category TEXT NOT NULL DEFAULT '' CHECK(length(usage_category) <= 64),
  status TEXT NOT NULL CHECK(status IN ('available','reserved','consumed','pending_finalization','rebated','expired','refunded','disputed','transferred')),
  created_at TEXT NOT NULL,
  usage_at TEXT,
  finalization_at TEXT,
  rebate_at TEXT,
  refund_at TEXT,
  expiration_at TEXT,
  related_show_id TEXT NOT NULL DEFAULT '',
  related_order_id TEXT NOT NULL DEFAULT '',
  related_video_id TEXT NOT NULL DEFAULT '',
  administrator_adjustment_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_ledger_member_created ON seller_stream_credit_ledger(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_ledger_member_status ON seller_stream_credit_ledger(member_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_stream_credit_alerts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  month_key TEXT NOT NULL CHECK(length(month_key) = 7),
  threshold_percent INTEGER NOT NULL CHECK(threshold_percent IN (50,75,90,100)),
  sent_at TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('dashboard','email')),
  detail TEXT NOT NULL DEFAULT '',
  UNIQUE(member_id, month_key, threshold_percent, channel),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_alerts_member_month ON seller_stream_credit_alerts(member_id, month_key DESC);

CREATE TABLE IF NOT EXISTS seller_stream_checkout_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('subscription','prepaid_credits')),
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL DEFAULT '',
  selected_plan_code TEXT NOT NULL DEFAULT '',
  selected_plan_name TEXT NOT NULL DEFAULT '',
  credit_quantity REAL NOT NULL DEFAULT 0,
  total_amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','expired','failed')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_checkout_sessions_member ON seller_stream_checkout_sessions(member_id, created_at DESC);
