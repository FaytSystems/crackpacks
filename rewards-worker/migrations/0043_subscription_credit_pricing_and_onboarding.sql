ALTER TABLE stream_credit_config_versions
  ADD COLUMN subscriber_extra_credit_price REAL NOT NULL DEFAULT 1.25;

UPDATE stream_credit_config_versions
SET prepaid_extra_credit_price = 1.50;

ALTER TABLE seller_stream_subscriptions
  ADD COLUMN onboarding_email_sent_at TEXT;
