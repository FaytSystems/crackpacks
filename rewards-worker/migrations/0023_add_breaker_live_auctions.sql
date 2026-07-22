CREATE TABLE IF NOT EXISTS breaker_auction_lots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','sold','cancelled')),
  starting_bid_cents INTEGER NOT NULL DEFAULT 100 CHECK(starting_bid_cents BETWEEN 1 AND 10000000),
  bid_increment_cents INTEGER NOT NULL DEFAULT 100 CHECK(bid_increment_cents BETWEEN 1 AND 1000000),
  current_bid_cents INTEGER,
  winning_member_id TEXT,
  opened_at TEXT,
  closes_at TEXT,
  sold_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES breaker_stream_sessions(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(winning_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_auction_lots_session_status ON breaker_auction_lots(session_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaker_auction_lots_live ON breaker_auction_lots(status, opened_at DESC);

CREATE TABLE IF NOT EXISTS breaker_auction_bids (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  bidder_member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000),
  status TEXT NOT NULL DEFAULT 'leading' CHECK(status IN ('leading','outbid','winning','void')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(lot_id) REFERENCES breaker_auction_lots(id),
  FOREIGN KEY(bidder_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_breaker_auction_bids_lot_amount ON breaker_auction_bids(lot_id, amount_cents DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_breaker_auction_bids_bidder ON breaker_auction_bids(bidder_member_id, created_at DESC);
