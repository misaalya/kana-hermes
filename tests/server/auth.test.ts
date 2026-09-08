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
import { SignJWT } from "jose";
import {
  DEFAULT_ACCESS_PASSWORD,
  changeAccessPassword,
  isUsingDefaultPassword,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import { checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { createSessionToken, sessionCookie, verifySessionToken } from "@/lib/server/auth/session";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as relayRpc } from "@/app/api/hermes/rpc/route";
import { PUT as saveActivities } from "@/app/api/kana/activities/route";
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
  it("admits only one bcrypt verification from a concurrent login burst", async () => {
    await changeAccessPassword("burst-test-secret");
    recordSuccess();
    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () => login(
        new Request("http://localhost/api/auth/login", {
          method: "POST", body: JSON.stringify({ password: "wrong" }),
        }),
      )));
      assert.equal(responses.filter((response) => response.status === 401).length, 1);
      assert.equal(responses.filter((response) => response.status === 429).length, 11);
      assert.equal(checkLock().locked, false);
      const success = await login(new Request("http://localhost/api/auth/login", {
        method: "POST", body: JSON.stringify({ password: "burst-test-secret" }),
      }));
      assert.equal(success.status, 200);
    } finally {
      recordSuccess();
      clearPersistedPassword();
    }
  });

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
  it("does not mint a new-version session from a login verified against an old password", async (context) => {
    await changeAccessPassword("previous-secret");
    const checking = Promise.withResolvers<void>();
    const verified = Promise.withResolvers<boolean>();
    const compare = context.mock.method(bcrypt, "compare", async () => {
      checking.resolve();
      return verified.promise;
    });
    try {
      const response = login(new Request("http://localhost/api/auth/login", {
        method: "POST", body: JSON.stringify({ password: "previous-secret" }),
      }));
      await checking.promise;
      await changeAccessPassword("replacement-secret");
      verified.resolve(true);
      const result = await response;
      assert.equal(result.status, 401);
      assert.equal(result.headers.has("set-cookie"), false);
    } finally {
      verified.resolve(false);
      compare.mock.restore();
      clearPersistedPassword();
    }
  });

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

  it("revokes old sessions on password change, including after the store reopens", async () => {
    try {
      const previousToken = await createSessionToken();
      const response = await changePassword(new Request("https://kana.example/api/auth/password", {
        method: "POST",
        headers: { cookie: `kana_session=${previousToken}` },
        body: JSON.stringify({ currentPassword: DEFAULT_ACCESS_PASSWORD, newPassword: "updated-secret" }),
      }));
      assert.equal(response.status, 200);
      const replacement = response.headers.get("set-cookie")!.split(";", 1)[0].slice("kana_session=".length);
      resetAppStateStoreForTests();
      assert.equal(await verifySessionToken(previousToken), false);
      assert.equal(await verifySessionToken(replacement), true);
      assert.equal(await verifyAccessPassword("updated-secret"), true);
    } finally {
      clearPersistedPassword();
    }
  });

  it("rejects a password bcrypt would truncate without revoking the current session", async () => {
    const token = await createSessionToken();
    for (const password of ["a".repeat(73), "あ".repeat(25)]) {
      await assert.rejects(changeAccessPassword(password), /72 UTF-8 bytes/);
      assert.equal(await verifySessionToken(token), true);
    }
  });

  it("requires authentication claims, expiration, and HS256", async () => {
    await createSessionToken();
    const secret = new TextEncoder().encode(readFileSync(path.join(dataDir, "jwt-secret"), "utf8").trim());
    const noExpiry = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(secret);
    const notAuthenticated = await new SignJWT({ authenticated: false }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    const wrongAlgorithm = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS384" }).setIssuedAt().setExpirationTime("1h").sign(secret);
    for (const token of [noExpiry, notAuthenticated, wrongAlgorithm]) {
      assert.equal(await verifySessionToken(token), false);
    }
  });

  it("marks direct HTTPS cookies Secure without requiring a forwarded header", () => {
    assert.match(sessionCookie("token", new Request("https://kana.example")), /; Secure$/);
  });

  it("returns controlled client errors for malformed and oversized API bodies", async () => {
    const token = await createSessionToken();
    const handlers = [login, changePassword, relayRpc, saveActivities];
    for (const handler of handlers) {
      const method = handler === saveActivities ? "PUT" : "POST";
      assert.equal((await handler(new Request("http://localhost/api/test", {
        method, headers: { cookie: `kana_session=${token}` }, body: "null",
      }))).status, 400);
      assert.equal((await handler(new Request("http://localhost/api/test", {
        method,
        headers: { cookie: `kana_session=${token}`, "content-length": "10000000" },
        body: "{}",
      }))).status, 413);
    }
  });

  it("rejects activity ordinals and anchors that SQLite cannot represent safely", async () => {
    const token = await createSessionToken();
    for (const fields of [
      { turnIndex: Number.MAX_SAFE_INTEGER + 1 },
      { turnIndex: "0" },
      { turnAnchorMs: 1e100 },
      { turnAnchorMs: true },
    ]) {
      const response = await saveActivities(new Request("http://localhost/api/kana/activities", {
        method: "PUT",
        headers: { cookie: `kana_session=${token}` },
        body: JSON.stringify({ session: "20260907_120000_abc123", turnAnchorMs: 1000, activities: [], ...fields }),
      }));
      assert.equal(response.status, 400);
    }
  });
});
