import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const initialMigration = readFileSync(new URL("../migrations/0000_initial.sql", import.meta.url), "utf8");
const redemptionRequestMigration = readFileSync(new URL("../migrations/0001_add_redemption_requested_at.sql", import.meta.url), "utf8");
const loginFlowMigration = readFileSync(new URL("../migrations/0002_add_login_code_auth_flow.sql", import.meta.url), "utf8");
const campaignMigration = readFileSync(new URL("../migrations/0003_add_offer_campaigns.sql", import.meta.url), "utf8");
const singleMigration = readFileSync(new URL("../migrations/0004_add_free_single_campaigns.sql", import.meta.url), "utf8");
const indefiniteMigration = readFileSync(new URL("../migrations/0005_add_indefinite_campaigns.sql", import.meta.url), "utf8");
const qrControlsMigration = readFileSync(new URL("../migrations/0006_add_qr_kill_switches.sql", import.meta.url), "utf8");
const inventoryMigration = readFileSync(new URL("../migrations/0007_add_inventory_products.sql", import.meta.url), "utf8");
const inventoryQuantityGuardMigration = readFileSync(new URL("../migrations/0008_guard_inventory_quantity.sql", import.meta.url), "utf8");
const productReactivationGuardMigration = readFileSync(new URL("../migrations/0009_guard_product_reactivation.sql", import.meta.url), "utf8");
const productFulfillmentMigration = readFileSync(new URL("../migrations/0010_decrement_fulfilled_product.sql", import.meta.url), "utf8");
const channelPricingMigration = readFileSync(new URL("../migrations/0011_add_channel_pricing.sql", import.meta.url), "utf8");
const memberTrackingMigration = readFileSync(new URL("../migrations/0012_add_member_orders_tracking.sql", import.meta.url), "utf8");
const seriesGiveawaysMigration = readFileSync(new URL("../migrations/0013_add_series_and_giveaways.sql", import.meta.url), "utf8");

function member(db, id, email, inviteCode) {
  db.prepare(`INSERT INTO members(id,email,email_verified_at,identity_status,device_verified,invite_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, email, "2026-07-16T00:00:00.000Z", "verified", 1, inviteCode, "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
}

test("campaign schema and sequential campaign migrations are valid", () => {
  const schemaDb = new DatabaseSync(":memory:");
  schemaDb.exec(schema);
  schemaDb.close();

  const migrationDb = new DatabaseSync(":memory:");
  migrationDb.exec(initialMigration);
  migrationDb.exec(redemptionRequestMigration);
  migrationDb.exec(loginFlowMigration);
  migrationDb.exec(campaignMigration);
  migrationDb.exec(singleMigration);
  migrationDb.exec(indefiniteMigration);
  migrationDb.exec(qrControlsMigration);
  migrationDb.exec(inventoryMigration);
  migrationDb.exec(inventoryQuantityGuardMigration);
  migrationDb.exec(productReactivationGuardMigration);
  migrationDb.exec(productFulfillmentMigration);
  migrationDb.exec(channelPricingMigration);
  migrationDb.exec(memberTrackingMigration);
  migrationDb.exec(seriesGiveawaysMigration);
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offer_campaigns'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='reward_variant'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='never_expires'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='is_active'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='owner_referral_controls'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_items'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='shipping_quotes'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='inventory_item_id'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_inventory_quantity_commitment_guard'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_product_campaign_reactivation_guard'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_product_redemption_decrements_inventory'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('inventory_items') WHERE name='website_list_price_cents'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('inventory_items') WHERE name='wholesale_pallet_list_price_cents'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='member_orders'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='order_shipments'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='easypost_webhook_events'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='seller_giveaways'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='gifted_giveaways'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('inventory_items') WHERE name='series'`).get());
  migrationDb.close();
});

test("campaign constraints reject missing reward data and duplicate claims", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  member(db, "owner", "owner@example.com", "CPOWNER001");
  member(db, "member-a", "a@example.com", "CPMEMBERA1");
  member(db, "member-b", "b@example.com", "CPMEMBERB1");
  const insertCampaign = db.prepare(`INSERT INTO offer_campaigns(id,owner_member_id,title,reward_type,percent,max_redemptions,pack_count,offer_token,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  assert.throws(() => insertCampaign.run("bad-percent", "owner", "Bad percent", "percent", null, 2, null, "OFRBADPERCENTTOKEN1234567890", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z"));
  assert.throws(() => insertCampaign.run("bad-pack", "owner", "Bad pack", "pack_draft", null, 2, null, "OFRBADPACKTOKEN1234567890123", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z"));
  insertCampaign.run("campaign-a", "owner", "Pack draft", "pack_draft", null, 2, 2, "OFRPACKTOKEN12345678901234567890", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  insertCampaign.run("campaign-b", "owner", "Ten percent", "percent", 10, 2, null, "OFRPERCENTTOKEN1234567890123456", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  insertCampaign.run("campaign-single", "owner", "First 50 halos", "pick_a_pack", null, 50, null, "OFRSINGLETOKEN123456789012345678", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  db.prepare(`UPDATE offer_campaigns SET reward_variant='free_single' WHERE id='campaign-single'`).run();
  assert.equal(db.prepare(`SELECT reward_variant FROM offer_campaigns WHERE id='campaign-single'`).get().reward_variant, "free_single");
  assert.throws(() => db.prepare(`UPDATE offer_campaigns SET reward_variant='free_single' WHERE id='campaign-b'`).run());
  db.prepare(`UPDATE offer_campaigns SET never_expires=1 WHERE id='campaign-single'`).run();
  assert.equal(db.prepare(`SELECT never_expires FROM offer_campaigns WHERE id='campaign-single'`).get().never_expires, 1);
  assert.throws(() => db.prepare(`UPDATE offer_campaigns SET never_expires=2 WHERE id='campaign-single'`).run());
  db.prepare(`UPDATE offer_campaigns SET is_active=0 WHERE id='campaign-single'`).run();
  assert.equal(db.prepare(`SELECT is_active FROM offer_campaigns WHERE id='campaign-single'`).get().is_active, 0);
  assert.throws(() => db.prepare(`UPDATE offer_campaigns SET is_active=2 WHERE id='campaign-single'`).run());
  db.prepare(`INSERT INTO inventory_items(id,owner_member_id,public_slug,name,upc,quantity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run("inventory-a", "owner", "test-booster-box", "Test Booster Box", "012345678901", 10, "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  insertCampaign.run("campaign-product", "owner", "Product reward", "pick_a_pack", null, 5, null, "OFRPRODUCTTOKEN123456789012345", "2026-07-17T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
  db.prepare(`UPDATE offer_campaigns SET inventory_item_id='inventory-a',product_name_snapshot='Test Booster Box',product_upc_snapshot='012345678901' WHERE id='campaign-product'`).run();
  assert.equal(db.prepare(`SELECT inventory_item_id FROM offer_campaigns WHERE id='campaign-product'`).get().inventory_item_id, "inventory-a");
  const insertClaim = db.prepare(`INSERT INTO campaign_redemptions(id,campaign_id,member_id,week_key,code,claim_rank,pack_number,claimed_at) VALUES(?,?,?,?,?,?,?,?)`);
  insertClaim.run("claim-a", "campaign-a", "member-a", "2026-07-16", "CODE-A", 1, 1, "2026-07-16T12:00:00.000Z");
  assert.throws(() => insertClaim.run("claim-pack", "campaign-a", "member-b", "2026-07-16", "CODE-B", 2, 1, "2026-07-16T12:01:00.000Z"));
  assert.throws(() => insertClaim.run("claim-week", "campaign-b", "member-a", "2026-07-16", "CODE-C", 1, null, "2026-07-16T12:02:00.000Z"));
  db.close();
});

test("product campaigns reserve stock and fulfillment decrements inventory", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  member(db, "owner", "owner@example.com", "CPOWNER002");
  member(db, "collector", "collector@example.com", "CPCOLLECT1");
  db.prepare(`INSERT INTO inventory_items(id,owner_member_id,public_slug,name,upc,quantity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run("inventory-product", "owner", "reserved-product", "Reserved Product", "012345678902", 5, "2026-07-18T00:00:00.000Z", "2026-07-18T00:00:00.000Z");
  db.prepare(`
    INSERT INTO offer_campaigns(
      id,owner_member_id,title,reward_type,max_redemptions,offer_token,expires_at,inventory_item_id,product_name_snapshot,product_upc_snapshot,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "product-campaign", "owner", "Reserved reward", "pick_a_pack", 4,
    "OFRRESERVEDPRODUCTTOKEN1234567890", "9999-12-31T23:59:59.999Z",
    "inventory-product", "Reserved Product", "012345678902", "2026-07-18T00:00:00.000Z"
  );
  db.prepare(`INSERT INTO campaign_redemptions(id,campaign_id,member_id,week_key,code,claim_rank,claimed_at) VALUES(?,?,?,?,?,?,?)`)
    .run("product-claim", "product-campaign", "collector", "2026-07-17", "PRODUCT-CODE", 1, "2026-07-18T01:00:00.000Z");

  assert.throws(() => db.prepare(`UPDATE inventory_items SET quantity=3 WHERE id='inventory-product'`).run(), /INVENTORY_COMMITMENT_CONFLICT/);
  db.prepare(`UPDATE offer_campaigns SET is_active=0 WHERE id='product-campaign'`).run();
  db.prepare(`UPDATE inventory_items SET quantity=1 WHERE id='inventory-product'`).run();
  assert.throws(() => db.prepare(`UPDATE offer_campaigns SET is_active=1 WHERE id='product-campaign'`).run(), /INVENTORY_COMMITMENT_CONFLICT/);
  db.prepare(`UPDATE inventory_items SET quantity=4 WHERE id='inventory-product'`).run();
  db.prepare(`UPDATE offer_campaigns SET is_active=1 WHERE id='product-campaign'`).run();
  db.prepare(`UPDATE campaign_redemptions SET redeemed_at='2026-07-18T02:00:00.000Z',redeemed_by_member_id='owner' WHERE id='product-claim'`).run();
  assert.equal(db.prepare(`SELECT quantity FROM inventory_items WHERE id='inventory-product'`).get().quantity, 3);
  assert.equal(db.prepare(`SELECT redeemed_at FROM campaign_redemptions WHERE id='product-claim'`).get().redeemed_at, "2026-07-18T02:00:00.000Z");
  db.close();
});
