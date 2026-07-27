CREATE TABLE IF NOT EXISTS employee_invitations (
  id TEXT PRIMARY KEY,
  target_email TEXT NOT NULL CHECK(length(target_email) BETWEEN 3 AND 254),
  target_member_id TEXT,
  employee_id TEXT NOT NULL UNIQUE CHECK(length(employee_id) BETWEEN 8 AND 40),
  code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash) = 64),
  job_title TEXT NOT NULL CHECK(length(job_title) BETWEEN 2 AND 100),
  hourly_rate_cents INTEGER NOT NULL CHECK(hourly_rate_cents BETWEEN 1 AND 1000000),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  created_by_member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  sent_at TEXT,
  used_at TEXT,
  used_by_member_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(target_member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_member_id) REFERENCES members(id),
  FOREIGN KEY(used_by_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_invitations_target
  ON employee_invitations(target_email, expires_at);

CREATE TABLE IF NOT EXISTS employee_profiles (
  member_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE CHECK(length(employee_id) BETWEEN 8 AND 40),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','suspended','terminated')),
  job_title TEXT NOT NULL CHECK(length(job_title) BETWEEN 2 AND 100),
  hourly_rate_cents INTEGER NOT NULL CHECK(hourly_rate_cents BETWEEN 1 AND 1000000),
  stripe_connect_account_id TEXT NOT NULL DEFAULT '' CHECK(length(stripe_connect_account_id) <= 120),
  stripe_connect_details_submitted INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_details_submitted IN (0,1)),
  stripe_connect_payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_payouts_enabled IN (0,1)),
  stripe_connect_requirements_due INTEGER NOT NULL DEFAULT 0 CHECK(stripe_connect_requirements_due BETWEEN 0 AND 1000),
  activated_at TEXT NOT NULL,
  created_by_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_status
  ON employee_profiles(status, updated_at);

CREATE TABLE IF NOT EXISTS employee_time_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  work_date TEXT NOT NULL CHECK(length(work_date) = 10),
  start_time TEXT NOT NULL CHECK(length(start_time) = 5),
  end_time TEXT NOT NULL CHECK(length(end_time) = 5),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 1440),
  minutes_worked INTEGER NOT NULL CHECK(minutes_worked BETWEEN 1 AND 1440),
  hourly_rate_cents INTEGER NOT NULL CHECK(hourly_rate_cents BETWEEN 1 AND 1000000),
  expected_pay_cents INTEGER NOT NULL CHECK(expected_pay_cents BETWEEN 1 AND 100000000),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','approved','rejected','paid')),
  reviewed_by_member_id TEXT,
  reviewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(reviewed_by_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_time_entries_member
  ON employee_time_entries(member_id, work_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_time_entries_status
  ON employee_time_entries(status, work_date DESC);

CREATE TABLE IF NOT EXISTS internal_email_messages (
  id TEXT PRIMARY KEY,
  sender_member_id TEXT NOT NULL,
  recipient_member_id TEXT,
  from_address TEXT NOT NULL CHECK(length(from_address) BETWEEN 3 AND 254),
  to_address TEXT NOT NULL CHECK(length(to_address) BETWEEN 3 AND 254),
  category TEXT NOT NULL DEFAULT 'direct'
    CHECK(category IN ('direct','employment')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 3 AND 120),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 5000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('queued','sent','failed')),
  sent_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(sender_member_id) REFERENCES members(id),
  FOREIGN KEY(recipient_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_internal_email_messages_sender
  ON internal_email_messages(sender_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_email_messages_recipient
  ON internal_email_messages(recipient_member_id, created_at DESC);
