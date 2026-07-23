import assert from "node:assert/strict";
import test from "node:test";
import { usernameKey } from "../src/platform-routes.js";

test("Crack Packs User ID key blocks case, separator, and common leetspeak clones", () => {
  assert.equal(usernameKey("CRACKPACKS"), "crackpacks");
  assert.equal(usernameKey("Crack_Packs"), "crackpacks");
  assert.equal(usernameKey("CR4CKP4CK5"), "crackpacks");
  assert.equal(usernameKey("crack---packs"), "crackpacks");
});

test("distinct User IDs keep distinct protected keys", () => {
  assert.notEqual(usernameKey("CrackPacks"), usernameKey("HaloCollector"));
});

