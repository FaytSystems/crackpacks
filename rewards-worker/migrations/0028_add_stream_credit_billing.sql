CREATE TABLE IF NOT EXISTS stream_credit_config_versions (
  id TEXT PRIMARY KEY,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_member_id TEXT,
  delivery_minutes_per_credit REAL NOT NULL DEFAULT 1000,
  storage_minutes_per_credit REAL NOT NULL DEFAULT 200,
  replay_reserve_percentage REAL NOT NULL DEFAULT 0.10,
  safety_buffer_percentage REAL NOT NULL DEFAULT 0.20,
  recording_retention_days REAL NOT NULL DEFAULT 90,
  month_days REAL NOT NULL DEFAULT 30,
  stream_credit_underlying_value REAL NOT NULL DEFAULT 1,
  prepaid_extra_credit_price REAL NOT NULL DEFAULT 1.85,
  payg_overage_price REAL NOT NULL DEFAULT 2.25,
  unused_credit_rebate_rate REAL NOT NULL DEFAULT 1,
  finalization_delay_hours REAL NOT NULL DEFAULT 72,
  protected_evidence_reserve_credits REAL NOT NULL DEFAULT 5,
  auto_refill_package_sizes_json TEXT NOT NULL DEFAULT '[10,25,50,100]',
  spending_limit_default REAL NOT NULL DEFAULT 250,
  cash_out_threshold REAL NOT NULL DEFAULT 25,
  prepaid_credit_expiration_months REAL NOT NULL DEFAULT 12,
  stripe_domestic_rate REAL NOT NULL DEFAULT 0.029,
  stripe_domestic_fixed_fee REAL NOT NULL DEFAULT 0.30,
  cloudflare_credit_cost_assumption REAL NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_config_effective ON stream_credit_config_versions(effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS stream_credit_plan_versions (
  id TEXT PRIMARY KEY,
  plan_code TEXT NOT NULL CHECK(length(plan_code) BETWEEN 2 AND 32),
  plan_name TEXT NOT NULL CHECK(length(plan_name) BETWEEN 2 AND 60),
  monthly_price REAL,
  included_credits REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_member_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(created_by_member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_stream_credit_plans_effective ON stream_credit_plan_versions(plan_code, effective_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_stream_subscriptions (
  member_id TEXT PRIMARY KEY,
  selected_plan_code TEXT NOT NULL DEFAULT 'starter',
  selected_plan_name TEXT NOT NULL DEFAULT 'Starter',
  monthly_price REAL,
  included_credits REAL NOT NULL DEFAULT 0,
  average_concurrent_viewers REAL NOT NULL DEFAULT 0,
  hours_per_show REAL NOT NULL DEFAULT 0,
  shows_per_month REAL NOT NULL DEFAULT 0,
  recording_retention_days REAL NOT NULL DEFAULT 90,
  replay_reserve_percentage REAL NOT NULL DEFAULT 0.10,
  safety_buffer_percentage REAL NOT NULL DEFAULT 0.20,
  expected_orders_per_show REAL,
  expected_growth_percentage REAL,
  desired_safety_buffer_percentage REAL,
  auto_refill_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_refill_enabled IN (0,1)),
  auto_refill_package_size REAL,
  auto_refill_trigger_balance REAL,
  auto_refill_monthly_spending_limit REAL,
  auto_refill_max_refills INTEGER,
  payg_enabled INTEGER NOT NULL DEFAULT 1 CHECK(payg_enabled IN (0,1)),
  payg_monthly_spending_limit REAL,
  prepaid_credits_balance REAL NOT NULL DEFAULT 0,
  pending_rebate_balance REAL NOT NULL DEFAULT 0,
  cash_out_eligible_balance REAL NOT NULL DEFAULT 0,
  current_config_version_id TEXT,
  current_plan_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(current_config_version_id) REFERENCES stream_credit_config_versions(id),
  FOREIGN KEY(current_plan_version_id) REFERENCES stream_credit_plan_versions(id)
);

CREATE TABLE IF NOT EXISTS seller_stream_usage_snapshots (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  month_key TEXT NOT NULL CHECK(length(month_key) = 7),
  actual_live_viewer_minutes REAL NOT NULL DEFAULT 0,
  actual_replay_minutes REAL NOT NULL DEFAULT 0,
  actual_buyer_video_minutes REAL NOT NULL DEFAULT 0,
  actual_protected_evidence_minutes REAL NOT NULL DEFAULT 0,
  actual_delivered_minutes REAL NOT NULL DEFAULT 0,
  actual_recorded_minutes REAL NOT NULL DEFAULT 0,
  actual_stored_minutes REAL NOT NULL DEFAULT 0,
  finalized_credits_used REAL NOT NULL DEFAULT 0,
  projected_exhaustion_at TEXT,
  finalization_due_at TEXT,
  finalized_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','system','imported')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(member_id, month_key),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_usage_member_month ON seller_stream_usage_snapshots(member_id, month_key DESC);

CREATE TABLE IF NOT EXISTS seller_stream_credit_ledger (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  subscription_id TEXT,
  credit_source TEXT NOT NULL CHECK(credit_source IN ('monthly_included','prepaid_rollover','auto_refill','payg_overage','rebate','cash_out','admin_adjustment','refund','transfer')),
  credit_quantity REAL NOT NULL DEFAULT 0,
  dollar_value REAL NOT NULL DEFAULT 0,
  usage_category TEXT NOT NULL DEFAULT '' CHECK(length(usage_category) <= 64),
  status TEXT NOT NULL CHECK(status IN ('available','reserved','consumed','pending_finalization','rebated','expired','refunded','disputed','transferred')),
  created_at TEXT NOT NULL,
  usage_at TEXT,
  finalization_at TEXT,
  rebate_at TEXT,
  refund_at TEXT,
  expiration_at TEXT,
  related_show_id TEXT NOT NULL DEFAULT '',
  related_order_id TEXT NOT NULL DEFAULT '',
  related_video_id TEXT NOT NULL DEFAULT '',
  administrator_adjustment_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_ledger_member_created ON seller_stream_credit_ledger(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_ledger_member_status ON seller_stream_credit_ledger(member_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_stream_credit_alerts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  month_key TEXT NOT NULL CHECK(length(month_key) = 7),
  threshold_percent INTEGER NOT NULL CHECK(threshold_percent IN (50,75,90,100)),
  sent_at TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('dashboard','email')),
  detail TEXT NOT NULL DEFAULT '',
  UNIQUE(member_id, month_key, threshold_percent, channel),
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_seller_stream_credit_alerts_member_month ON seller_stream_credit_alerts(member_id, month_key DESC);
