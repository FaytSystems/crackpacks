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
