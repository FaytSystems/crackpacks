INSERT OR IGNORE INTO stream_credit_config_versions(
  id,effective_at,created_at,created_by_member_id,delivery_minutes_per_credit,storage_minutes_per_credit,replay_reserve_percentage,safety_buffer_percentage,
  recording_retention_days,month_days,stream_credit_underlying_value,prepaid_extra_credit_price,subscriber_extra_credit_price,payg_overage_price,unused_credit_rebate_rate,
  finalization_delay_hours,protected_evidence_reserve_credits,auto_refill_package_sizes_json,spending_limit_default,cash_out_threshold,
  prepaid_credit_expiration_months,stripe_domestic_rate,stripe_domestic_fixed_fee,cloudflare_credit_cost_assumption,notes
)
SELECT
  'stream-credit-config-0048',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,
  delivery_minutes_per_credit,storage_minutes_per_credit,replay_reserve_percentage,safety_buffer_percentage,
  recording_retention_days,month_days,1,1.50,1.25,1.25,1,
  finalization_delay_hours,protected_evidence_reserve_credits,auto_refill_package_sizes_json,spending_limit_default,cash_out_threshold,
  prepaid_credit_expiration_months,stripe_domestic_rate,stripe_domestic_fixed_fee,1,
  'Four seller-profile tiers; $1 unused-credit face value and $1.25 subscriber overage rate'
FROM stream_credit_config_versions
ORDER BY effective_at DESC, created_at DESC
LIMIT 1;

INSERT OR IGNORE INTO stream_credit_plan_versions(
  id,plan_code,plan_name,monthly_price,included_credits,sort_order,is_public,effective_at,created_at,created_by_member_id,notes
) VALUES
  ('stream-credit-plan-0048-starter','starter','Starter',29,25,1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,'Occasional streaming profile'),
  ('stream-credit-plan-0048-growth','growth','Growth',99,75,2,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,'Average streaming profile'),
  ('stream-credit-plan-0048-pro','pro','Pro',525,425,3,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,'Full-time streaming profile'),
  ('stream-credit-plan-0048-power','power','Power',1999,1600,4,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,'High-viewer streaming profile'),
  ('stream-credit-plan-0048-enterprise','enterprise','Enterprise',NULL,NULL,5,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,'Custom usage profile');

UPDATE seller_stream_subscriptions
SET selected_plan_name=CASE selected_plan_code
      WHEN 'starter' THEN 'Starter'
      WHEN 'growth' THEN 'Growth'
      WHEN 'pro' THEN 'Pro'
      WHEN 'power' THEN 'Power'
      ELSE selected_plan_name
    END,
    monthly_price=CASE selected_plan_code
      WHEN 'starter' THEN 29
      WHEN 'growth' THEN 99
      WHEN 'pro' THEN 525
      WHEN 'power' THEN 1999
      ELSE monthly_price
    END,
    included_credits=CASE selected_plan_code
      WHEN 'starter' THEN 25
      WHEN 'growth' THEN 75
      WHEN 'pro' THEN 425
      WHEN 'power' THEN 1600
      ELSE included_credits
    END,
    current_config_version_id='stream-credit-config-0048',
    current_plan_version_id=CASE selected_plan_code
      WHEN 'starter' THEN 'stream-credit-plan-0048-starter'
      WHEN 'growth' THEN 'stream-credit-plan-0048-growth'
      WHEN 'pro' THEN 'stream-credit-plan-0048-pro'
      WHEN 'power' THEN 'stream-credit-plan-0048-power'
      ELSE current_plan_version_id
    END,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE selected_plan_code IN ('starter','growth','pro','power')
  AND (
    COALESCE(stripe_subscription_id,'')=''
    OR lower(COALESCE(stripe_subscription_status,'')) IN ('canceled','unpaid','incomplete','incomplete_expired')
  );
