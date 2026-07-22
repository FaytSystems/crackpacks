CREATE TABLE IF NOT EXISTS offer_campaigns (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  reward_type TEXT NOT NULL CHECK(reward_type IN ('percent','free_shipping','pick_a_pack','pack_draft')),
  percent INTEGER,
  max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 500),
  pack_count INTEGER,
  offer_token TEXT NOT NULL UNIQUE CHECK(length(offer_token) BETWEEN 20 AND 80),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(expires_at > created_at),
  CHECK(
    (reward_type = 'percent' AND percent IS NOT NULL AND percent BETWEEN 1 AND 100 AND pack_count IS NULL) OR
    (reward_type = 'pack_draft' AND percent IS NULL AND pack_count IS NOT NULL AND pack_count BETWEEN max_redemptions AND 500) OR
    (reward_type IN ('free_shipping','pick_a_pack') AND percent IS NULL AND pack_count IS NULL)
  ),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_offer_campaigns_created ON offer_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_campaigns_expires ON offer_campaigns(expires_at);

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
