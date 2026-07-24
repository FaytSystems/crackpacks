ALTER TABLE members ADD COLUMN referral_code_used TEXT;

ALTER TABLE members ADD COLUMN referral_source TEXT NOT NULL DEFAULT '';

ALTER TABLE members ADD COLUMN referral_tagged_at TEXT;

ALTER TABLE members ADD COLUMN referral_awarded_at TEXT;

ALTER TABLE login_codes ADD COLUMN referral_code_used TEXT;

ALTER TABLE login_codes ADD COLUMN referral_source TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_members_referral_awards
  ON members(referred_by_member_id, referral_qualified_at, referral_awarded_at);

CREATE INDEX IF NOT EXISTS idx_members_referral_code_used
  ON members(referral_code_used, created_at);
