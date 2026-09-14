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
import { after, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import {
  changeAccessPassword,
  isAccessPasswordConfigured,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import {
  checkLock,
  recordFail,
  recordSuccess,
  resetLoginLimiterForTests,
} from "@/lib/server/auth/login-limiter";
import {
  createSessionToken,
  LOGIN_DEVICE_COOKIE,
  SESSION_COOKIE,
  sessionCookie,
  verifySessionToken,
} from "@/lib/server/auth/session";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as authStatus } from "@/app/api/auth/status/route";
import { POST as relayRpc } from "@/app/api/hermes/rpc/route";
import { PUT as saveActivities } from "@/app/api/kana/activities/route";
import { resetAppStateStoreForTests, setAppState } from "@/lib/server/app-state-store";

// All auth configuration is read lazily, so pointing KANA_DATA_DIR at a
// temporary directory here isolates every test run.
const dataDir = mkdtempSync(path.join(tmpdir(), "kana-auth-test-"));
process.env.KANA_DATA_DIR = dataDir;
delete process.env.KANA_JWT_SECRET;

after(() => {
  resetAppStateStoreForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetLoginLimiterForTests();
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

function loginRequest(password: string, cookie?: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: JSON.stringify({ password }),
  });
}

function cookieValue(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function storedPasswordRecord(): { passwordHash?: string; sessionVersion?: string } | null {
  resetAppStateStoreForTests();
  const database = new DatabaseSync(path.join(dataDir, "appstate.db"));
  const row = database
    .prepare("SELECT value FROM app_state WHERE key = 'auth.password'")
    .get() as { value: string } | undefined;
  database.close();
  resetAppStateStoreForTests();
  return JSON.parse(row?.value ?? "null");
}

describe("access password store", () => {
  it("has no password and refuses every login on a fresh installation", async () => {
    clearPersistedPassword();
    assert.equal(isAccessPasswordConfigured(), false);
    assert.equal(await verifyAccessPassword("chankana123"), false);
    assert.equal(await verifyAccessPassword(""), false);

    const response = await login(loginRequest("anything-at-all"));
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { code?: string }).code, "password_not_configured");

    const status = (await (await authStatus(new Request("http://localhost/api/auth/status"))).json()) as Record<string, unknown>;
    assert.equal(status.passwordConfigured, false);
    assert.equal("defaultPassword" in status, false);
    assert.equal("configError" in status, false);
  });

  it("stores a scrypt hash and verifies only the chosen password", async () => {
    try {
      await changeAccessPassword("persistent-secret");
      assert.equal(isAccessPasswordConfigured(), true);
      assert.equal(await verifyAccessPassword("persistent-secret"), true);
      assert.equal(await verifyAccessPassword("persistent-secreT"), false);
      assert.equal(existsSync(path.join(dataDir, "auth.json")), false);
      assert.match(storedPasswordRecord()?.passwordHash ?? "", /^scrypt\$/);
      await assert.rejects(() => changeAccessPassword(""));
      await assert.rejects(() => changeAccessPassword("short"), /at least 8/);
      await assert.rejects(() => changeAccessPassword(" padded-secret "), /whitespace/);
      await assert.rejects(() => changeAccessPassword("a".repeat(257)), /at most 256/);
    } finally {
      clearPersistedPassword();
    }
  });

  it("migrates a legacy auth.json bcrypt hash and upgrades it to scrypt on login", async () => {
    const legacyPassword = "legacy-secret";
    writeFileSync(
      path.join(dataDir, "auth.json"),
      JSON.stringify({ passwordHash: await bcrypt.hash(legacyPassword, 4), sessionVersion: "kept" }),
      { mode: 0o600 },
    );

    try {
      assert.equal(await verifyAccessPassword("wrong-secret"), false);
      assert.equal(existsSync(path.join(dataDir, "auth.json")), false);
      assert.match(storedPasswordRecord()?.passwordHash ?? "", /^\$2[aby]\$/);

      assert.equal(await verifyAccessPassword(legacyPassword), true);
      const upgraded = storedPasswordRecord();
      assert.match(upgraded?.passwordHash ?? "", /^scrypt\$/);
      // Upgrading must not sign anybody out.
      assert.equal(upgraded?.sessionVersion, "kept");
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
      assert.equal(isAccessPasswordConfigured(), true);
      assert.equal(await verifyAccessPassword("temporary-secret"), false);
    } finally {
      clearPersistedPassword();
    }
  });
});

describe("login limiter", () => {
  it("admits only one hash verification from a concurrent login burst", async () => {
    await changeAccessPassword("burst-test-secret");
    try {
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => login(loginRequest("wrong-password"))),
      );
      assert.equal(responses.filter((response) => response.status === 401).length, 1);
      assert.equal(responses.filter((response) => response.status === 429).length, 11);
      assert.equal(checkLock().locked, false);
      const success = await login(loginRequest("burst-test-secret"));
      assert.equal(success.status, 200);
    } finally {
      clearPersistedPassword();
    }
  });

  it("locks progressively after repeated failures and resets on success", () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(checkLock().locked, false);
      const { remainingBeforeLock } = recordFail();
      if (i < 4) assert.equal(remainingBeforeLock > 0, true);
    }
    assert.equal(checkLock().locked, true);
    recordSuccess();
    assert.equal(checkLock().locked, false);
  });

  it("keeps a previously signed-in browser usable while unknown clients are locked out", async () => {
    await changeAccessPassword("owner-secret");
    try {
      const first = await login(loginRequest("owner-secret"));
      assert.equal(first.status, 200);
      const deviceToken = cookieValue(first, LOGIN_DEVICE_COOKIE);
      assert.ok(deviceToken, "a successful login issues a device cookie");
      assert.match(
        first.headers.getSetCookie().find((header) => header.startsWith(LOGIN_DEVICE_COOKIE)) ?? "",
        /HttpOnly; SameSite=Strict; Path=\/api\/auth/,
      );

      // An attacker without the device cookie exhausts the shared bucket.
      for (let i = 0; i < 5; i += 1) await login(loginRequest(`guess-${i}-password`));
      assert.equal((await login(loginRequest("owner-secret"))).status, 429);

      // The owner's browser has its own bucket and still signs in.
      const owner = await login(loginRequest("owner-secret", `${LOGIN_DEVICE_COOKIE}=${deviceToken}`));
      assert.equal(owner.status, 200);

      // A forged device cookie falls back to the locked shared bucket.
      const forged = await login(loginRequest("owner-secret", `${LOGIN_DEVICE_COOKIE}=forged.token.value`));
      assert.equal(forged.status, 429);
    } finally {
      clearPersistedPassword();
    }
  });

  it("demotes every known device when the password changes", async () => {
    await changeAccessPassword("before-rotation");
    try {
      const staleToken = cookieValue(await login(loginRequest("before-rotation")), LOGIN_DEVICE_COOKIE);
      assert.ok(staleToken);
      // e.g. `kana password` after a suspected compromise.
      await changeAccessPassword("after-rotation");

      for (let i = 0; i < 5; i += 1) await login(loginRequest(`guess-${i}-password`));
      // The old device cookie no longer grants its own lenient bucket.
      const stale = await login(loginRequest("after-rotation", `${LOGIN_DEVICE_COOKIE}=${staleToken}`));
      assert.equal(stale.status, 429);

      // A device cookie minted for the current password does.
      resetLoginLimiterForTests();
      const freshToken = cookieValue(await login(loginRequest("after-rotation")), LOGIN_DEVICE_COOKIE);
      for (let i = 0; i < 5; i += 1) await login(loginRequest(`guess-${i}-password`));
      const fresh = await login(loginRequest("after-rotation", `${LOGIN_DEVICE_COOKIE}=${freshToken}`));
      assert.equal(fresh.status, 200);
    } finally {
      clearPersistedPassword();
    }
  });

  it("keeps the changing browser a known device after a web password change", async () => {
    await changeAccessPassword("web-before-change");
    try {
      const signedIn = await login(loginRequest("web-before-change"));
      const session = cookieValue(signedIn, SESSION_COOKIE);
      const response = await changePassword(new Request("http://localhost/api/auth/password", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${session}` },
        body: JSON.stringify({ currentPassword: "web-before-change", newPassword: "web-after-change" }),
      }));
      assert.equal(response.status, 200);
      const deviceToken = cookieValue(response, LOGIN_DEVICE_COOKIE);
      assert.ok(deviceToken, "the password change re-issues the device cookie");

      for (let i = 0; i < 5; i += 1) await login(loginRequest(`guess-${i}-password`));
      const owner = await login(loginRequest("web-after-change", `${LOGIN_DEVICE_COOKIE}=${deviceToken}`));
      assert.equal(owner.status, 200);
    } finally {
      clearPersistedPassword();
    }
  });

  it("limits a known device's own failures without touching other buckets", async () => {
    await changeAccessPassword("device-secret");
    try {
      const deviceToken = cookieValue(await login(loginRequest("device-secret")), LOGIN_DEVICE_COOKIE);
      const cookie = `${LOGIN_DEVICE_COOKIE}=${deviceToken}`;
      let status = 0;
      for (let i = 0; i < 10; i += 1) status = (await login(loginRequest(`mistyped-${i}-pass`, cookie))).status;
      assert.equal(status, 429);
      assert.equal(checkLock().locked, false, "the unknown-client bucket is unaffected");
    } finally {
      clearPersistedPassword();
    }
  });
});

describe("JWT session tokens", () => {
  it("does not mint a new-version session from a login verified against an old password", async (context) => {
    setAppState("auth.password", { passwordHash: await bcrypt.hash("previous-secret", 4) });
    const checking = Promise.withResolvers<void>();
    const verified = Promise.withResolvers<boolean>();
    const compare = context.mock.method(bcrypt, "compare", async () => {
      checking.resolve();
      return verified.promise;
    });
    try {
      const response = login(loginRequest("previous-secret"));
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
    await changeAccessPassword("token-secret");
    try {
      const token = await createSessionToken();
      const secretFile = path.join(dataDir, "jwt-secret");
      const generated = readFileSync(secretFile, "utf8").trim();
      assert.equal(generated.length, 64);
      assert.equal(statSync(secretFile).mode & 0o777, 0o600);
      assert.equal(await verifySessionToken(token), true);
      assert.equal(await verifySessionToken(`${token}x`), false);
      assert.equal(await verifySessionToken("garbage"), false);
      assert.equal(await verifySessionToken(null), false);
      assert.equal(await verifySessionToken(undefined), false);
    } finally {
      clearPersistedPassword();
    }
  });

  it("refuses to mint or accept sessions while no password is configured", async () => {
    clearPersistedPassword();
    await assert.rejects(() => createSessionToken(), /authentication state is invalid/);
  });

  it("revokes old sessions on password change, including after the store reopens", async () => {
    await changeAccessPassword("original-secret");
    try {
      const previousToken = await createSessionToken();
      const response = await changePassword(new Request("https://kana.example/api/auth/password", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${previousToken}` },
        body: JSON.stringify({ currentPassword: "original-secret", newPassword: "updated-secret" }),
      }));
      assert.equal(response.status, 200);
      const replacement = cookieValue(response, SESSION_COOKIE)!;
      resetAppStateStoreForTests();
      assert.equal(await verifySessionToken(previousToken), false);
      assert.equal(await verifySessionToken(replacement), true);
      assert.equal(await verifyAccessPassword("updated-secret"), true);
    } finally {
      clearPersistedPassword();
    }
  });

  it("revokes only the logged-out token on the server", async () => {
    await changeAccessPassword("logout-secret");
    try {
      const loggedOut = await createSessionToken();
      const otherBrowser = await createSessionToken();
      const response = await logout(new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${loggedOut}` },
      }));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
      assert.equal(await verifySessionToken(loggedOut), false);
      assert.equal(await verifySessionToken(otherBrowser), true);
      resetAppStateStoreForTests();
      assert.equal(await verifySessionToken(loggedOut), false, "revocation survives a reopen");
    } finally {
      clearPersistedPassword();
    }
  });

  it("requires authentication claims, expiration, and HS256", async () => {
    await changeAccessPassword("claims-secret");
    try {
      await createSessionToken();
      const secret = new TextEncoder().encode(readFileSync(path.join(dataDir, "jwt-secret"), "utf8").trim());
      const noExpiry = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(secret);
      const notAuthenticated = await new SignJWT({ authenticated: false }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
      const wrongAlgorithm = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS384" }).setIssuedAt().setExpirationTime("1h").sign(secret);
      const deviceToken = await new SignJWT({ typ: "login-device", did: "x" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
      for (const token of [noExpiry, notAuthenticated, wrongAlgorithm, deviceToken]) {
        assert.equal(await verifySessionToken(token), false);
      }
    } finally {
      clearPersistedPassword();
    }
  });

  it("marks direct HTTPS cookies Secure without requiring a forwarded header", () => {
    assert.match(sessionCookie("token", new Request("https://kana.example")), /; Secure$/);
  });

  it("returns controlled client errors for malformed and oversized API bodies", async () => {
    await changeAccessPassword("bodies-secret");
    try {
      const token = await createSessionToken();
      const handlers = [login, changePassword, relayRpc, saveActivities];
      for (const handler of handlers) {
        const method = handler === saveActivities ? "PUT" : "POST";
        assert.equal((await handler(new Request("http://localhost/api/test", {
          method, headers: { cookie: `${SESSION_COOKIE}=${token}` }, body: "null",
        }))).status, 400);
        assert.equal((await handler(new Request("http://localhost/api/test", {
          method,
          headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-length": "10000000" },
          body: "{}",
        }))).status, 413);
      }
    } finally {
      clearPersistedPassword();
    }
  });

  it("rejects activity ordinals and anchors that SQLite cannot represent safely", async () => {
    await changeAccessPassword("activity-secret");
    try {
      const token = await createSessionToken();
      for (const fields of [
        { turnIndex: Number.MAX_SAFE_INTEGER + 1 },
        { turnIndex: "0" },
        { turnAnchorMs: 1e100 },
        { turnAnchorMs: true },
      ]) {
        const response = await saveActivities(new Request("http://localhost/api/kana/activities", {
          method: "PUT",
          headers: { cookie: `${SESSION_COOKIE}=${token}` },
          body: JSON.stringify({ session: "20260907_120000_abc123", turnAnchorMs: 1000, activities: [], ...fields }),
        }));
        assert.equal(response.status, 400);
      }
    } finally {
      clearPersistedPassword();
    }
  });
});
