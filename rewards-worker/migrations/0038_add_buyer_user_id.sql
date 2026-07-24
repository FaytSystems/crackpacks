ALTER TABLE members ADD COLUMN buyer_username TEXT;
ALTER TABLE members ADD COLUMN buyer_username_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_buyer_username ON members(buyer_username) WHERE buyer_username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_buyer_username_key ON members(buyer_username_key) WHERE buyer_username_key IS NOT NULL;
