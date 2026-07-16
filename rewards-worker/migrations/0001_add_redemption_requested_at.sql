ALTER TABLE discount_claims ADD COLUMN redemption_requested_at TEXT;
ALTER TABLE discount_claims ADD COLUMN redeemed_by_member_id TEXT;
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
