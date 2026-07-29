CREATE TABLE IF NOT EXISTS live_show_chat_messages (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 280),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY(show_id) REFERENCES breaker_stream_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_live_show_chat_show_time
  ON live_show_chat_messages(show_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_show_chat_member_time
  ON live_show_chat_messages(member_id, created_at DESC);
