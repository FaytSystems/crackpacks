CREATE TABLE IF NOT EXISTS stream_credit_codes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 100),
  code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash) = 64),
  code_hint TEXT NOT NULL CHECK(length(code_hint) BETWEEN 4 AND 20),
  credit_quantity REAL NOT NULL CHECK(credit_quantity BETWEEN 0.01 AND 10000),
  distribution_type TEXT NOT NULL CHECK(distribution_type IN ('individual','email','limited')),
  target_member_id TEXT,
  target_email TEXT,
  max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 500),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  created_by_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (distribution_type='individual' AND target_member_id IS NOT NULL AND target_email IS NULL AND max_redemptions=1) OR
    (distribution_type='email' AND target_email IS NOT NULL AND length(target_email) BETWEEN 3 AND 254 AND max_redemptions=1) OR
    (distribution_type='limited' AND target_member_id IS NULL AND target_email IS NULL)
  ),
  FOREIGN KEY(target_member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_codes_created ON stream_credit_codes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_credit_codes_target_member ON stream_credit_codes(target_member_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_credit_codes_target_email ON stream_credit_codes(target_email,created_at DESC);

CREATE TABLE IF NOT EXISTS stream_credit_code_redemptions (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  credits_granted REAL NOT NULL CHECK(credits_granted BETWEEN 0.01 AND 10000),
  redeemed_at TEXT NOT NULL,
  UNIQUE(code_id,member_id),
  FOREIGN KEY(code_id) REFERENCES stream_credit_codes(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_code_redemptions_code ON stream_credit_code_redemptions(code_id,redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_credit_code_redemptions_member ON stream_credit_code_redemptions(member_id,redeemed_at DESC);

ALTER TABLE breaker_stream_sessions ADD COLUMN credit_metered_at TEXT;
ALTER TABLE breaker_stream_sessions ADD COLUMN credit_metered_units REAL NOT NULL DEFAULT 0 CHECK(credit_metered_units >= 0);
ALTER TABLE breaker_stream_sessions ADD COLUMN credit_reconciled_units REAL NOT NULL DEFAULT 0 CHECK(credit_reconciled_units >= 0);
ALTER TABLE breaker_stream_sessions ADD COLUMN credit_exhausted_at TEXT;
ALTER TABLE breaker_stream_sessions ADD COLUMN credit_shutdown_at TEXT;
ALTER TABLE breaker_stream_sessions ADD COLUMN stream_end_reason TEXT NOT NULL DEFAULT '' CHECK(length(stream_end_reason) <= 64);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_credit_gate ON breaker_stream_sessions(status,credit_shutdown_at);
