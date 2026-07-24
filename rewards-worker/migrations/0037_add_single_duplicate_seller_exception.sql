CREATE TABLE IF NOT EXISTS owner_duplicate_seller_exception (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  member_id TEXT NOT NULL UNIQUE,
  identity_review_id TEXT NOT NULL UNIQUE,
  approved_by_member_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(identity_review_id) REFERENCES identity_review_queue(id),
  FOREIGN KEY(approved_by_member_id) REFERENCES members(id)
);
