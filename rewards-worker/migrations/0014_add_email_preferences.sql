ALTER TABLE login_codes ADD COLUMN signup_intent TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS member_email_preferences (
  member_id TEXT PRIMARY KEY,
  drop_alerts_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(drop_alerts_opt_in IN (0,1)),
  drop_alerts_opted_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_member_email_preferences_alerts ON member_email_preferences(drop_alerts_opt_in, updated_at DESC);
