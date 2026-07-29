ALTER TABLE breaker_auction_lots ADD COLUMN queue_position INTEGER;
ALTER TABLE breaker_auction_lots ADD COLUMN auction_duration_seconds INTEGER NOT NULL DEFAULT 30
  CHECK(auction_duration_seconds BETWEEN 5 AND 3600);

UPDATE breaker_auction_lots
SET queue_position = rowid
WHERE queue_position IS NULL;

CREATE INDEX IF NOT EXISTS idx_breaker_auction_lots_queue
  ON breaker_auction_lots(session_id, status, queue_position);
