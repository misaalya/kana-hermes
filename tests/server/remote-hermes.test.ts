import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  configErrorRuntimeStatus,
  remoteAuthAvailable,
  remoteHealthUrl,
  remoteHermesIntent,
  remoteLoginUrl,
  remotePassword,
  remoteRuntimeId,
  remoteRuntimeStatus,
  remoteTicketUrl,
  remoteWebSocketUrl,
} from "@/lib/server/remote-hermes";
import type { KanaRemoteHermesConfig } from "@/lib/server/user-config";

const remote: KanaRemoteHermesConfig = {
  url: "wss://hermes.example.com/hermes/api/ws",
  auth: { mode: "password", username: "misa", password: "test-password" },
};

const previous = process.env.KANA_TEST_REMOTE_PASSWORD;
after(() => {
  if (previous === undefined) delete process.env.KANA_TEST_REMOTE_PASSWORD;
  else process.env.KANA_TEST_REMOTE_PASSWORD = previous;
});

describe("remote Hermes transport values", () => {
  it("appends the single-use ticket only to the WebSocket URL", () => {
    const url = new URL(remoteWebSocketUrl(remote, "ticket value&more"));
    assert.equal(url.searchParams.get("ticket"), "ticket value&more");
    assert.equal(url.pathname, "/hermes/api/ws");
  });

  it("derives login, ticket, and health endpoints beside the gateway path", () => {
    assert.equal(
      remoteLoginUrl(remote),
      "https://hermes.example.com/hermes/auth/password-login",
    );
    assert.equal(
      remoteTicketUrl(remote),
      "https://hermes.example.com/hermes/api/auth/ws-ticket",
    );
    assert.equal(
      remoteHealthUrl(remote),
      "https://hermes.example.com/hermes/api/health",
    );
  });

  it("separates remote intent from unrelated config errors", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kana-remote-intent-"));
    const previousDataDir = process.env.KANA_DATA_DIR;
    process.env.KANA_DATA_DIR = root;
    try {
      assert.equal(remoteHermesIntent(), "local");
      writeFileSync(path.join(root, "config.json"), JSON.stringify({ tts: { provider: "bad" } }));
      assert.equal(remoteHermesIntent(), "local");
      writeFileSync(
        path.join(root, "config.json"),
        JSON.stringify({ hermes: { remote: { url: "wss://hermes.example.com" } } }),
      );
      assert.equal(remoteHermesIntent(), "remote");
      writeFileSync(path.join(root, "config.json"), "{ not json");
      assert.equal(remoteHermesIntent(), "unknown");
    } finally {
      if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
      else process.env.KANA_DATA_DIR = previousDataDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an unreadable config without a raw parse error", () => {
    const status = configErrorRuntimeStatus();
    assert.equal(status.configError, true);
    assert.equal(status.controlAvailable, false);
    assert.equal(status.state, "failed");
    assert.equal(status.message.includes("/"), false);
    assert.match(status.message, /config\.json/);
  });

  it("gives each remote installation an opaque, stable runtime identity", () => {
    const id = remoteRuntimeId(remote);
    assert.match(id, /^remote-[a-f0-9]{16}$/);
    assert.equal(remoteRuntimeId({ ...remote }), id);
    assert.notEqual(
      remoteRuntimeId({ ...remote, url: "wss://other.example.com/api/ws" }),
      id,
    );
    assert.notEqual(
      remoteRuntimeId({ ...remote, auth: { ...remote.auth, username: "other" } }),
      id,
    );
    assert.equal(id.includes("hermes.example.com"), false);
    assert.equal(id.includes("misa"), false);
  });

  it("reports remote status without the endpoint, username, password, or machine id", () => {
    const status = remoteRuntimeStatus(
      {
        ...remote,
        auth: { mode: "password", username: "private-user", password: "very-secret" },
        instabox: { machineId: "m_private_machine" },
      },
      false,
    );
    assert.equal(status.mode, "remote");
    assert.equal(status.controlAvailable, false);
    assert.equal(status.state, "stopped");
    assert.equal(status.authAvailable, true);
    assert.equal(status.wakeAvailable, true);
    assert.equal(
      remoteRuntimeStatus(remote, false).wakeAvailable,
      false,
      "a remote without an instabox block has nothing Kana could wake",
    );
    assert.match(status.runtimeId, /^remote-[a-f0-9]{16}$/);
    assert.equal(
      remoteRuntimeStatus(remote, true, "remote-ffffffffffffffff").runtimeId,
      "remote-ffffffffffffffff",
      "the live socket's runtime, not an edited config, labels the connection",
    );
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes("hermes.example.com"), false);
    assert.equal(serialized.includes("private-user"), false);
    assert.equal(serialized.includes("very-secret"), false);
    assert.equal(serialized.includes("m_private_machine"), false);
  });

  it("reads the password from its named environment variable without echoing it", () => {
    process.env.KANA_TEST_REMOTE_PASSWORD = "env-secret";
    const envRemote: KanaRemoteHermesConfig = {
      url: "wss://hermes.example.com",
      auth: { mode: "password", username: "misa", passwordEnv: "KANA_TEST_REMOTE_PASSWORD" },
    };
    assert.equal(remotePassword(envRemote), "env-secret");
    assert.equal(remoteAuthAvailable(envRemote), true);

    delete process.env.KANA_TEST_REMOTE_PASSWORD;
    assert.throws(
      () => remotePassword(envRemote),
      (error: unknown) =>
        error instanceof Error
        && /KANA_TEST_REMOTE_PASSWORD/.test(error.message)
        && !error.message.includes("env-secret"),
    );
    assert.equal(remoteAuthAvailable(envRemote), false);
  });
});
