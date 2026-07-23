CREATE TABLE IF NOT EXISTS stream_viewer_presence (
  stream_session_id TEXT NOT NULL,
  viewer_key TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(stream_session_id, viewer_key),
  FOREIGN KEY(stream_session_id) REFERENCES breaker_stream_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_stream_viewer_presence_seen
  ON stream_viewer_presence(stream_session_id, last_seen_at);
