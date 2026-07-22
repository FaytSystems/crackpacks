CREATE TABLE IF NOT EXISTS breaker_stream_inputs (
  member_id TEXT PRIMARY KEY,
  cloudflare_live_input_uid TEXT NOT NULL UNIQUE CHECK(length(cloudflare_live_input_uid) BETWEEN 1 AND 64),
  rtmps_url TEXT NOT NULL DEFAULT '' CHECK(length(rtmps_url) <= 300),
  rtmps_stream_key TEXT NOT NULL DEFAULT '' CHECK(length(rtmps_stream_key) <= 500),
  srt_url TEXT NOT NULL DEFAULT '' CHECK(length(srt_url) <= 500),
  srt_stream_id TEXT NOT NULL DEFAULT '' CHECK(length(srt_stream_id) <= 300),
  srt_passphrase TEXT NOT NULL DEFAULT '' CHECK(length(srt_passphrase) <= 300),
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','enabled','disabled','live','ended','error')),
  created_by_member_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_inputs_status ON breaker_stream_inputs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS breaker_stream_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  cloudflare_live_input_uid TEXT NOT NULL CHECK(length(cloudflare_live_input_uid) BETWEEN 1 AND 64),
  cloudflare_recording_video_uid TEXT NOT NULL DEFAULT '' CHECK(length(cloudflare_recording_video_uid) <= 64),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 160),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','live','ended','recording_ready','closed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_sessions_member_started ON breaker_stream_sessions(member_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_sessions_status ON breaker_stream_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS breaker_stream_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('stream_start','auction_start','auction_won','next_auction_start','stream_end','recording_ready')),
  event_at TEXT NOT NULL,
  buyer_email TEXT NOT NULL DEFAULT '' CHECK(length(buyer_email) <= 254),
  order_reference TEXT NOT NULL DEFAULT '' CHECK(length(order_reference) <= 120),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES breaker_stream_sessions(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_events_session_time ON breaker_stream_events(session_id, event_at ASC);
CREATE INDEX IF NOT EXISTS idx_breaker_stream_events_member_time ON breaker_stream_events(member_id, event_at DESC);

ALTER TABLE breaker_sales ADD COLUMN stream_session_id TEXT;
ALTER TABLE breaker_sales ADD COLUMN auction_won_event_id TEXT;
ALTER TABLE breaker_sales ADD COLUMN next_auction_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_breaker_sales_stream_session ON breaker_sales(stream_session_id, sale_occurred_at DESC);
