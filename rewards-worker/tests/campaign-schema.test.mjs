import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0003_add_offer_campaigns.sql", import.meta.url), "utf8");

function member(db, id, email, inviteCode) {
  db.prepare(`INSERT INTO members(id,email,email_verified_at,identity_status,device_verified,invite_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, email, "2026-07-16T00:00:00.000Z", "verified", 1, inviteCode, "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
}

test("campaign schema is valid and campaign migration is idempotent", () => {
  const schemaDb = new DatabaseSync(":memory:");
  schemaDb.exec(schema);
  schemaDb.exec(migration);
  schemaDb.close();

  const migrationDb = new DatabaseSync(":memory:");
  migrationDb.exec(schema.split("CREATE TABLE IF NOT EXISTS offer_campaigns")[0]);
  migrationDb.exec(migration);
  migrationDb.exec(migration);
  assert.ok(migrationDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offer_campaigns'`).get());
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
  const insertClaim = db.prepare(`INSERT INTO campaign_redemptions(id,campaign_id,member_id,week_key,code,claim_rank,pack_number,claimed_at) VALUES(?,?,?,?,?,?,?,?)`);
  insertClaim.run("claim-a", "campaign-a", "member-a", "2026-07-16", "CODE-A", 1, 1, "2026-07-16T12:00:00.000Z");
  assert.throws(() => insertClaim.run("claim-pack", "campaign-a", "member-b", "2026-07-16", "CODE-B", 2, 1, "2026-07-16T12:01:00.000Z"));
  assert.throws(() => insertClaim.run("claim-week", "campaign-b", "member-a", "2026-07-16", "CODE-C", 1, null, "2026-07-16T12:02:00.000Z"));
  db.close();
});
