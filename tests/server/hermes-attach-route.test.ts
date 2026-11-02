import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { POST as attach } from "@/app/api/hermes/session/attach/route";
import { createSessionToken } from "@/lib/server/auth/session";
import { changeAccessPassword } from "@/lib/server/auth/password-store";
import { __setHermesGatewayConnectedForTests } from "@/lib/server/hermes-bridge";
import {
  __resetHermesSessionRegistryForTests,
  noteHermesRpcResult,
} from "@/lib/server/hermes-session-registry";

const root = mkdtempSync(path.join(tmpdir(), "kana-attach-route-"));
const previous = process.env.KANA_DATA_DIR;
const KEY = "20260824_052417_fe475b";
let token = "";

before(async () => {
  process.env.KANA_DATA_DIR = root;
  await changeAccessPassword("attach-route-secret");
  token = await createSessionToken();
});

after(() => {
  __resetHermesSessionRegistryForTests();
  __setHermesGatewayConnectedForTests(null);
  if (previous === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  __resetHermesSessionRegistryForTests();
  __setHermesGatewayConnectedForTests(true);
});

function request(body: unknown, authenticated = true): Request {
  return new Request("http://kana.test/api/hermes/session/attach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Cookie: `kana_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

it("requires the Kana session cookie", async () => {
  const response = await attach(request({ persistentSessionId: KEY }, false));
  assert.equal(response.status, 401);
});

it("serves the live snapshot for the authenticated browser", async () => {
  noteHermesRpcResult(
    "session.resume",
    { persistentSessionId: KEY },
    {
      session_id: "runtime-attach",
      stored_session_id: KEY,
      messages: [{ role: "user", text: "Hello" }],
      running: false,
    },
  );
  const response = await attach(request({ persistentSessionId: KEY }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    attached: boolean;
    session: { session_id: string; messages: Array<{ text: string }> };
  };
  assert.equal(body.attached, true);
  assert.equal(body.session.session_id, "runtime-attach");
  assert.deepEqual(body.session.messages, [{ role: "user", text: "Hello" }]);
});

it("reports a miss instead of opening an arbitrary session", async () => {
  const response = await attach(request({ persistentSessionId: KEY }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { attached: false });
});

it("rejects a malformed durable id", async () => {
  const response = await attach(request({ persistentSessionId: "../other" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { attached: false });
});
