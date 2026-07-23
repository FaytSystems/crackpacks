ALTER TABLE members ADD COLUMN stripe_payment_method_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_payment_method_id) <= 120);
ALTER TABLE members ADD COLUMN stripe_payment_method_brand TEXT NOT NULL DEFAULT '' CHECK(length(stripe_payment_method_brand) <= 40);
ALTER TABLE members ADD COLUMN stripe_payment_method_last4 TEXT NOT NULL DEFAULT '' CHECK(length(stripe_payment_method_last4) <= 4);

CREATE INDEX IF NOT EXISTS idx_members_stripe_customer
  ON members(stripe_customer_id)
  WHERE stripe_customer_id <> '';
