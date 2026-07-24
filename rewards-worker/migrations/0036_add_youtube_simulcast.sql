ALTER TABLE breaker_stream_inputs ADD COLUMN youtube_output_uid TEXT;
ALTER TABLE breaker_stream_inputs ADD COLUMN youtube_output_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breaker_stream_inputs ADD COLUMN youtube_channel_url TEXT;
