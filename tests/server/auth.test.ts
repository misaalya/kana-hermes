import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  bootstrapPassword,
  changeAccessPassword,
  isAuthEnabled,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import { checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { createSessionToken, verifySessionToken } from "@/lib/server/auth/session";

// All auth configuration is read lazily, so pointing KANA_DATA_DIR at a
// temporary directory here isolates every test run.
const dataDir = mkdtempSync(path.join(tmpdir(), "kana-auth-test-"));
process.env.KANA_DATA_DIR = dataDir;
delete process.env.KANA_ACCESS_PASSWORD;
delete process.env.KANA_JWT_SECRET;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("access password store", () => {
  it("reports auth disabled with no bootstrap password and no stored hash", () => {
    assert.equal(bootstrapPassword(), null);
    assert.equal(isAuthEnabled(), false);
  });

  it("verifies against the bootstrap environment password", async () => {
    process.env.KANA_ACCESS_PASSWORD = "bootstrap-secret";
    try {
      assert.equal(isAuthEnabled(), true);
      assert.equal(await verifyAccessPassword("bootstrap-secret"), true);
      assert.equal(await verifyAccessPassword("wrong"), false);
      assert.equal(await verifyAccessPassword(""), false);
    } finally {
      delete process.env.KANA_ACCESS_PASSWORD;
    }
  });

  it("prefers a persisted bcrypt hash over the environment value", async () => {
    process.env.KANA_ACCESS_PASSWORD = "bootstrap-secret";
    try {
      await changeAccessPassword("persistent-secret");
      assert.equal(await verifyAccessPassword("persistent-secret"), true);
      assert.equal(await verifyAccessPassword("bootstrap-secret"), false);
      // A wrong current password must never be accepted for a change.
      await assert.rejects(() => changeAccessPassword(""));
    } finally {
      delete process.env.KANA_ACCESS_PASSWORD;
      rmSync(path.join(dataDir, "auth.json"), { force: true });
    }
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
    const secretFile = path.join(dataDir, "jwt-secret");
    const generated = readFileSync(secretFile, "utf8").trim();
    assert.equal(generated.length, 64);
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    assert.notEqual(token.includes("."), false);
    assert.equal(await verifySessionToken(token), true);
    assert.equal(await verifySessionToken(`${token}x`), false);
    assert.equal(await verifySessionToken("garbage"), false);
    assert.equal(await verifySessionToken(null), false);
    assert.equal(await verifySessionToken(undefined), false);
  });
});
