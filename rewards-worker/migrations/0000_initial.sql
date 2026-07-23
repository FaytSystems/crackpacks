PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  first_name TEXT,
  last_name TEXT,
  birth_date TEXT,
  legacy_marketplace_username TEXT UNIQUE,
  identity_fingerprint TEXT UNIQUE,
  identity_status TEXT NOT NULL DEFAULT 'pending',
  device_verified INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL UNIQUE,
  referred_by_member_id TEXT,
  referral_qualified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(referred_by_member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  inviter_member_id TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL,
  UNIQUE(inviter_member_id, invitee_email),
  FOREIGN KEY(inviter_member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS discount_claims (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  percent INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_member ON webauthn_credentials(member_id);

CREATE TABLE IF NOT EXISTS security_challenges (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  type TEXT NOT NULL,
  ip_hash TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
