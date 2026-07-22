ALTER TABLE login_codes ADD COLUMN auth_flow TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE login_codes ADD COLUMN referrer_member_id TEXT;
