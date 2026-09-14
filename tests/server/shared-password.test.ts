import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, passwordPolicyError, verifyScryptHash } from "@/shared/password.mjs";

describe("shared scrypt password hashing", () => {
  it("round-trips, salts every hash, and rejects wrong or malformed input", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");
    assert.match(first, /^scrypt\$15\$8\$1\$/);
    assert.notEqual(first, second);
    assert.equal(await verifyScryptHash("correct horse", first), true);
    assert.equal(await verifyScryptHash("correct horsE", first), false);
    assert.equal(await verifyScryptHash("correct horse", "scrypt$15$8$1$short$bad"), false);
    assert.equal(await verifyScryptHash("correct horse", "scrypt$40$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA"), false);
    assert.equal(await verifyScryptHash("correct horse", "$2b$10$legacy"), false);
  });

  it("does not truncate long passwords the way bcrypt does", async () => {
    const hash = await hashPassword(`${"a".repeat(80)}X`);
    assert.equal(await verifyScryptHash(`${"a".repeat(80)}Y`, hash), false);
  });

  it("normalizes Unicode so composed and decomposed input match", async () => {
    const hash = await hashPassword("kata-sandi-\u00e9");
    assert.equal(await verifyScryptHash("kata-sandi-e\u0301", hash), true);
  });

  it("explains policy violations", () => {
    assert.equal(passwordPolicyError("long-enough"), null);
    assert.match(passwordPolicyError("short") ?? "", /at least 8/);
    assert.match(passwordPolicyError(" leading-space") ?? "", /whitespace/);
    assert.match(passwordPolicyError(42) ?? "", /required/);
  });
});
