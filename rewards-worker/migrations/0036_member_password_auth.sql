ALTER TABLE members ADD COLUMN password_hash TEXT NOT NULL DEFAULT '' CHECK(length(password_hash) <= 256);
ALTER TABLE members ADD COLUMN password_salt TEXT NOT NULL DEFAULT '' CHECK(length(password_salt) <= 80);
ALTER TABLE members ADD COLUMN password_updated_at TEXT;
ALTER TABLE members ADD COLUMN password_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(password_failed_attempts BETWEEN 0 AND 1000);
ALTER TABLE members ADD COLUMN password_locked_until TEXT;
