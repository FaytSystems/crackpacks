CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by_member_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(updated_by_member_id) REFERENCES members(id)
);
