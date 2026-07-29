import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0049_stream_credit_codes_and_live_gating.sql", import.meta.url), "utf8");
const stamp = "2026-07-29T12:00:00.000Z";
const hash = character => character.repeat(64);

function member(db, id, email, inviteCode) {
  db.prepare(`
    INSERT INTO members(id,email,email_verified_at,identity_status,device_verified,invite_code,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(id, email, stamp, "verified", 1, inviteCode, stamp, stamp);
}

test("stream credit code schema enforces recipient modes and one redemption per account", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  member(db, "owner", "owner@example.com", "CPOWNER49");
  member(db, "seller-a", "seller-a@example.com", "CPSELLER49");

  const insertCode = db.prepare(`
    INSERT INTO stream_credit_codes(
      id,title,code_hash,code_hint,credit_quantity,distribution_type,target_member_id,target_email,
      max_redemptions,is_active,expires_at,created_by_member_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  insertCode.run("individual", "Seller credit", hash("a"), "ends AAAA", 5.25, "individual", "seller-a", null, 1, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp);
  insertCode.run("email", "Email credit", hash("b"), "ends BBBB", 2, "email", null, "future@example.com", 1, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp);
  insertCode.run("limited", "Limited credit", hash("c"), "ends CCCC", 1.5, "limited", null, null, 25, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp);

  assert.throws(() => insertCode.run("bad-individual", "Bad individual", hash("d"), "ends DDDD", 1, "individual", "seller-a", null, 2, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp));
  assert.throws(() => insertCode.run("bad-limited", "Bad limited", hash("e"), "ends EEEE", 1, "limited", "seller-a", null, 5, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp));
  assert.throws(() => insertCode.run("bad-quantity", "Bad quantity", hash("f"), "ends FFFF", 0, "limited", null, null, 5, 1, "9999-12-31T23:59:59.999Z", "owner", stamp, stamp));

  const redeem = db.prepare(`INSERT INTO stream_credit_code_redemptions(id,code_id,member_id,credits_granted,redeemed_at) VALUES(?,?,?,?,?)`);
  redeem.run("redemption-a", "individual", "seller-a", 5.25, stamp);
  assert.throws(() => redeem.run("redemption-b", "individual", "seller-a", 5.25, stamp));
  db.close();
});

test("live gating migration upgrades existing sessions without changing their status", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE members(id TEXT PRIMARY KEY);
    CREATE TABLE breaker_stream_sessions(
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open'
    );
    INSERT INTO members(id) VALUES('owner'),('seller-a');
    INSERT INTO breaker_stream_sessions(id,status) VALUES('show-a','live');
  `);
  db.exec(migration);
  const columns = new Set(db.prepare(`SELECT name FROM pragma_table_info('breaker_stream_sessions')`).all().map(row => row.name));
  for (const name of ["credit_metered_at", "credit_metered_units", "credit_reconciled_units", "credit_exhausted_at", "credit_shutdown_at", "stream_end_reason"]) {
    assert.equal(columns.has(name), true);
  }
  const show = db.prepare(`SELECT status,credit_metered_units,credit_reconciled_units,stream_end_reason FROM breaker_stream_sessions WHERE id='show-a'`).get();
  assert.deepEqual({ ...show }, { status: "live", credit_metered_units: 0, credit_reconciled_units: 0, stream_end_reason: "" });
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_breaker_stream_credit_gate'`).get());
  db.close();
});
