ALTER TABLE members ADD COLUMN stripe_identity_result_email_status TEXT NOT NULL DEFAULT ''
  CHECK(stripe_identity_result_email_status IN ('','verified','failed'));

ALTER TABLE members ADD COLUMN stripe_identity_result_email_sent_at TEXT;
