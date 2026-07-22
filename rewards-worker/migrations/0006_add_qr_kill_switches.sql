ALTER TABLE offer_campaigns
ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
CHECK(is_active IN (0,1));

CREATE TABLE IF NOT EXISTS owner_referral_controls (
  owner_member_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_member_id, slot_id),
  FOREIGN KEY(owner_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_owner_referral_controls_updated
ON owner_referral_controls(updated_at DESC);
