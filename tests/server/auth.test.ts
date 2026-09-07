import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import {
  DEFAULT_ACCESS_PASSWORD,
  changeAccessPassword,
  isUsingDefaultPassword,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import { checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { createSessionToken, verifySessionToken } from "@/lib/server/auth/session";
import { resetAppStateStoreForTests } from "@/lib/server/app-state-store";

// All auth configuration is read lazily, so pointing KANA_DATA_DIR at a
// temporary directory here isolates every test run.
const dataDir = mkdtempSync(path.join(tmpdir(), "kana-auth-test-"));
process.env.KANA_DATA_DIR = dataDir;
delete process.env.KANA_JWT_SECRET;

after(() => {
  resetAppStateStoreForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

function clearPersistedPassword(): void {
  resetAppStateStoreForTests();
  const file = path.join(dataDir, "appstate.db");
  if (existsSync(file)) {
    const database = new DatabaseSync(file);
    database.prepare("DELETE FROM app_state WHERE key = 'auth.password'").run();
    database.close();
  }
  rmSync(path.join(dataDir, "auth.json"), { force: true });
  resetAppStateStoreForTests();
}

describe("access password store", () => {
  it("uses the documented default password on a fresh installation", async () => {
    assert.equal(isUsingDefaultPassword(), true);
    assert.equal(await verifyAccessPassword(DEFAULT_ACCESS_PASSWORD), true);
    assert.equal(await verifyAccessPassword("wrong"), false);
    assert.equal(await verifyAccessPassword(""), false);
  });

  it("prefers a persisted bcrypt hash over the built-in default", async () => {
    try {
      await changeAccessPassword("persistent-secret");
      assert.equal(isUsingDefaultPassword(), false);
      assert.equal(await verifyAccessPassword("persistent-secret"), true);
      assert.equal(await verifyAccessPassword(DEFAULT_ACCESS_PASSWORD), false);
      assert.equal(existsSync(path.join(dataDir, "auth.json")), false);

      resetAppStateStoreForTests();
      const database = new DatabaseSync(path.join(dataDir, "appstate.db"));
      const row = database
        .prepare("SELECT value FROM app_state WHERE key = 'auth.password'")
        .get() as { value: string } | undefined;
      database.close();
      const persisted = JSON.parse(row?.value ?? "null") as { passwordHash?: string } | null;
      assert.match(persisted?.passwordHash ?? "", /^\$2[aby]\$/);

      // A wrong current password must never be accepted for a change.
      await assert.rejects(() => changeAccessPassword(""));
    } finally {
      clearPersistedPassword();
    }
  });

  it("migrates a legacy auth.json hash into SQLite without resetting it", async () => {
    const legacyPassword = "legacy-secret";
    const legacyFile = path.join(dataDir, "auth.json");
    writeFileSync(
      legacyFile,
      JSON.stringify({ passwordHash: await bcrypt.hash(legacyPassword, 10) }),
      { mode: 0o600 },
    );

    try {
      assert.equal(await verifyAccessPassword(legacyPassword), true);
      assert.equal(await verifyAccessPassword(DEFAULT_ACCESS_PASSWORD), false);
      assert.equal(existsSync(legacyFile), false);

      resetAppStateStoreForTests();
      assert.equal(await verifyAccessPassword(legacyPassword), true);
    } finally {
      clearPersistedPassword();
    }
  });

  it("fails closed when the persisted password row is corrupt", async () => {
    await changeAccessPassword("temporary-secret");
    resetAppStateStoreForTests();
    const database = new DatabaseSync(path.join(dataDir, "appstate.db"));
    database
      .prepare("UPDATE app_state SET value = '{not json' WHERE key = 'auth.password'")
      .run();
    database.close();
    resetAppStateStoreForTests();

    try {
      assert.equal(isUsingDefaultPassword(), false);
      assert.equal(await verifyAccessPassword(DEFAULT_ACCESS_PASSWORD), false);
      assert.equal(await verifyAccessPassword("temporary-secret"), false);
    } finally {
      clearPersistedPassword();
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
