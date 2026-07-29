import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0048_reprice_stream_credit_plans.sql", import.meta.url), "utf8");

test("stream credit pricing migration versions plans without repricing active Stripe subscriptions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.exec(`
    INSERT INTO members(id,email,email_verified_at,identity_status,device_verified,invite_code,created_at,updated_at)
    VALUES
      ('inactive-seller','inactive@example.com','2026-07-01T00:00:00.000Z','verified',1,'CPINACTIVE','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      ('active-seller','active@example.com','2026-07-01T00:00:00.000Z','verified',1,'CPACTIVE01','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
    INSERT INTO stream_credit_config_versions(id,effective_at,created_at,payg_overage_price,unused_credit_rebate_rate)
    VALUES('old-config','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z',1.75,0.75);
    INSERT INTO stream_credit_plan_versions(id,plan_code,plan_name,monthly_price,included_credits,sort_order,is_public,effective_at,created_at)
    VALUES
      ('old-starter','starter','Starter',49,30,1,1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      ('old-growth','growth','Growth',99,65,2,1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      ('old-pro','pro','Pro',249,200,3,1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
    INSERT INTO seller_stream_subscriptions(member_id,selected_plan_code,selected_plan_name,monthly_price,included_credits,stripe_subscription_status,created_at,updated_at)
    VALUES
      ('inactive-seller','growth','Growth',99,65,'','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      ('active-seller','pro','Pro',249,200,'active','2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
    UPDATE seller_stream_subscriptions SET stripe_subscription_id='sub_active' WHERE member_id='active-seller';
  `);

  db.exec(migration);

  const config = db.prepare(`SELECT payg_overage_price,unused_credit_rebate_rate,subscriber_extra_credit_price FROM stream_credit_config_versions WHERE id='stream-credit-config-0048'`).get();
  assert.deepEqual({ ...config }, { payg_overage_price: 1.25, unused_credit_rebate_rate: 1, subscriber_extra_credit_price: 1.25 });
  const plans = db.prepare(`SELECT plan_code,monthly_price,included_credits FROM stream_credit_plan_versions WHERE id LIKE 'stream-credit-plan-0048-%' AND plan_code<>'enterprise' ORDER BY sort_order`).all();
  assert.deepEqual(plans.map(plan => ({ ...plan })), [
    { plan_code: "starter", monthly_price: 29, included_credits: 25 },
    { plan_code: "growth", monthly_price: 99, included_credits: 75 },
    { plan_code: "pro", monthly_price: 525, included_credits: 425 },
    { plan_code: "power", monthly_price: 1999, included_credits: 1600 }
  ]);
  const inactive = db.prepare(`SELECT monthly_price,included_credits,current_plan_version_id FROM seller_stream_subscriptions WHERE member_id='inactive-seller'`).get();
  assert.deepEqual({ ...inactive }, { monthly_price: 99, included_credits: 75, current_plan_version_id: "stream-credit-plan-0048-growth" });
  const active = db.prepare(`SELECT monthly_price,included_credits FROM seller_stream_subscriptions WHERE member_id='active-seller'`).get();
  assert.deepEqual({ ...active }, { monthly_price: 249, included_credits: 200 });
  db.close();
});
