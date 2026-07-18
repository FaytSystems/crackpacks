import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const campaignMigration = readFileSync(new URL("../migrations/0003_add_offer_campaigns.sql", import.meta.url), "utf8");
const singleMigration = readFileSync(new URL("../migrations/0004_add_free_single_campaigns.sql", import.meta.url), "utf8");
const indefiniteMigration = readFileSync(new URL("../migrations/0005_add_indefinite_campaigns.sql", import.meta.url), "utf8");
const qrControlsMigration = readFileSync(new URL("../migrations/0006_add_qr_kill_switches.sql", import.meta.url), "utf8");

function member(db, id, email, inviteCode) {
  db.prepare(`INSERT INTO members(id,email,email_verified_at,identity_status,device_verified,invite_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, email, "2026-07-16T00:00:00.000Z", "verified", 1, inviteCode, "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
}

test("campaign schema and sequential campaign migrations are valid", () => {
  const schemaDb = new DatabaseSync(":memory:");
  schemaDb.exec(schema);
  schemaDb.close();

  const migrationDb = new DatabaseSync(":memory:");
  migrationDb.exec(schema.split("CREATE TABLE IF NOT EXISTS offer_campaigns")[0]);
  migrationDb.exec(campaignMigration);
  migrationDb.exec(singleMigration);
  migrationDb.exec(indefiniteMigration);
  migrationDb.exec(qrControlsMigration);
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offer_campaigns'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='reward_variant'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='never_expires'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM pragma_table_info('offer_campaigns') WHERE name='is_active'`).get());
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='owner_referral_controls'`).get());
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
  const insertClaim = db.prepare(`INSERT INTO campaign_redemptions(id,campaign_id,member_id,week_key,code,claim_rank,pack_number,claimed_at) VALUES(?,?,?,?,?,?,?,?)`);
  insertClaim.run("claim-a", "campaign-a", "member-a", "2026-07-16", "CODE-A", 1, 1, "2026-07-16T12:00:00.000Z");
  assert.throws(() => insertClaim.run("claim-pack", "campaign-a", "member-b", "2026-07-16", "CODE-B", 2, 1, "2026-07-16T12:01:00.000Z"));
  assert.throws(() => insertClaim.run("claim-week", "campaign-b", "member-a", "2026-07-16", "CODE-C", 1, null, "2026-07-16T12:02:00.000Z"));
  db.close();
});
