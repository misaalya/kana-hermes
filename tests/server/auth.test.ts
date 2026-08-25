import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  changeAccessPassword,
  isAuthEnabled,
  isDefaultPassword,
  isUsingDefaultPassword,
  resetPasswordStoreForTests,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import { checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { createSessionToken, verifySessionToken } from "@/lib/server/auth/session";

// All auth state lives in SQLite under KANA_DATA_DIR, read lazily through a
// cached handle — pointing the variable at a temporary directory here
// isolates every test run.
const dataDir = mkdtempSync(path.join(tmpdir(), "kana-auth-test-"));
process.env.KANA_DATA_DIR = dataDir;
delete process.env.KANA_ACCESS_PASSWORD;
delete process.env.KANA_JWT_SECRET;

after(() => {
  resetPasswordStoreForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("access password store", () => {
  it("always enables auth by seeding the default-password hash", () => {
    assert.equal(isDefaultPassword("123456"), true);
    assert.equal(isAuthEnabled(), true);
    assert.equal(isUsingDefaultPassword(), true);
  });

  it("verifies the seeded default and rejects everything else", async () => {
    assert.equal(await verifyAccessPassword("123456"), true);
    assert.equal(await verifyAccessPassword("wrong"), false);
    assert.equal(await verifyAccessPassword(""), false);
    // The plaintext default must never exist in the data directory.
  });

  it("replaces the default after a password change and never looks back", async () => {
    await changeAccessPassword("persistent-secret");
    assert.equal(isUsingDefaultPassword(), false);
    assert.equal(await verifyAccessPassword("persistent-secret"), true);
    assert.equal(await verifyAccessPassword("123456"), false);
    await assert.rejects(() => changeAccessPassword(""));
    await assert.rejects(() => changeAccessPassword("short"));
  });

  it("stores only a bcrypt hash in SQLite — no plaintext anywhere", () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "appstate.db"));
    const row = db.prepare("SELECT password_hash FROM auth_password WHERE id = 1").get() as {
      password_hash: string;
    };
    db.close();
    assert.match(row.password_hash, /^\$2[aby]\$/);
    assert.doesNotMatch(row.password_hash, /persistent-secret/);
  });
});

describe("login limiter", () => {
  it("locks progressively after repeated failures and resets on success", () => {
    recordSuccess();
    for (let i = 0; i < 5; i += 1) {
      const state = checkLock();
      assert.equal(state.locked, false);
      const { remainingBeforeLock } = recordFail();
      if (i < 4) {
        assert.equal(remainingBeforeLock > 0, true);
        assert.equal(checkLock().locked, false);
      }
    }
    // Fifth failure triggers the first lock step.
    assert.equal(checkLock().locked, true);
    recordSuccess();
    assert.equal(checkLock().locked, false);
  });
});

describe("JWT session tokens", () => {
  it("round-trips a valid token and rejects forged or empty ones", async () => {
    const token = await createSessionToken();
    assert.notEqual(token.includes("."), false);
    assert.equal(await verifySessionToken(token), true);
    assert.equal(await verifySessionToken(`${token}x`), false);
    assert.equal(await verifySessionToken("garbage"), false);
    assert.equal(await verifySessionToken(null), false);
    assert.equal(await verifySessionToken(undefined), false);
  });
});
