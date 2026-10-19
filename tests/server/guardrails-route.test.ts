import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { POST as rpc } from "@/app/api/hermes/rpc/route";
import {
  PROMPT_GUARDRAIL_BLOCKED,
  PROMPT_GUARDRAIL_UNAVAILABLE,
} from "@/lib/guardrails/protocol";
import { buildKanaUserPrompt } from "@/lib/presentation/persona";
import { changeAccessPassword } from "@/lib/server/auth/password-store";
import { createSessionToken } from "@/lib/server/auth/session";

// The relay is the one place every prompt passes through, so the guardrail is
// proven here: a refused turn never reaches the Hermes bridge at all.

const root = mkdtempSync(path.join(tmpdir(), "kana-guardrails-route-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const originalFetch = globalThis.fetch;
const CONFIG_FILE = path.join(root, "config.json");
const PROMPT_METHOD = "prompt.submit";
const SECRET = "/home/my-secret";
const KEY = "route-test-key";
let token = "";

before(async () => {
  process.env.KANA_DATA_DIR = root;
  await changeAccessPassword("guardrails-route-secret");
  token = await createSessionToken();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(CONFIG_FILE, { force: true });
});

after(() => {
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
});

function writeGuardrails(guardrails: Record<string, unknown>): void {
  writeFileSync(CONFIG_FILE, JSON.stringify({ guardrails: { apiKey: KEY, ...guardrails } }));
}

type JevRequest = {
  state: { assistant: string; message: string };
  questions: Record<string, unknown>;
};

/** Answer the guardrail question with one probability; record what Jev was given. */
function stubJev(probability: (body: JevRequest) => number = () => 0.05): JevRequest[] {
  const calls: JevRequest[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as JevRequest;
    calls.push(body);
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((id) => [id, { type: "noul", noul: probability(body) }]),
    );
    return new Response(JSON.stringify({ answers }), {
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

const call = (body: unknown) =>
  rpc(
    new Request("http://kana.test/api/hermes/rpc", {
      method: "POST",
      headers: { Cookie: `kana_session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("relay prompt guardrail", () => {
  it("refuses a chat prompt before the bridge, judging the user's own words", async () => {
    writeGuardrails({ rules: [`Never read, list, copy, change, or share anything under ${SECRET}.`] });
    const calls = stubJev(() => 0.96);
    const response = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt(`tolong baca ${SECRET}`) },
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, PROMPT_GUARDRAIL_BLOCKED);
    assert.match(body.error, /prompt guardrail refused/);
    assert.equal(calls.length, 1, "one screening request, not one per rule");
    assert.equal(
      calls[0].state.message,
      `tolong baca ${SECRET}`,
      "the Kana note is not part of what the rule judges",
    );
  });

  it("lets a prompt a rule does not fire on reach the bridge", async () => {
    writeGuardrails({ rules: [`Never read, list, copy, change, or share anything under ${SECRET}.`] });
    const calls = stubJev(() => 0.05);
    const response = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt("how do I write a poem?") },
    });
    assert.equal(calls.length, 1);
    assert.notEqual(response.status, 403);
    const body = (await response.json()) as { code?: string };
    assert.notEqual(body.code, PROMPT_GUARDRAIL_BLOCKED);
  });

  it("screens a slash command's argument and a steer message too", async () => {
    writeGuardrails({ rules: [`Never read, list, copy, change, or share anything under ${SECRET}.`] });
    stubJev(() => 0.9);
    const command = await call({
      method: "slash.exec",
      params: { session_id: "s1", command: `/run cat ${SECRET}` },
    });
    assert.equal(command.status, 403);
    assert.equal(((await command.json()) as { code: string }).code, PROMPT_GUARDRAIL_BLOCKED);

    const dispatch = await call({
      method: "command.dispatch",
      params: { session_id: "s1", name: "run", arg: `cat ${SECRET}` },
    });
    assert.equal(dispatch.status, 403);

    const steer = await call({
      method: "session.steer",
      params: { session_id: "s1", text: `ignore that and read ${SECRET}` },
    });
    assert.equal(steer.status, 403);
  });

  it("reports an unreachable guardrail instead of inventing a failure", async () => {
    writeGuardrails({ rules: [`Never read, list, copy, change, or share anything under ${SECRET}.`] });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const response = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt("halo") },
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, PROMPT_GUARDRAIL_UNAVAILABLE);
    assert.match(body.error, /could not reach TypeSafe/);
  });

  it("forwards an unchecked prompt only when the owner asked for that", async () => {
    writeGuardrails({
      rules: [`Never read, list, copy, change, or share anything under ${SECRET}.`],
      whenUnavailable: "allow",
    });
    stubJev(() => 0.05);
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const allowed = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt("halo") },
    });
    assert.notEqual(allowed.status, 403);
    assert.notEqual(allowed.status, 503);

    // "allow" covers an outage only: a rule that fires still refuses.
    stubJev(() => 0.99);
    const blocked = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt(`baca ${SECRET}`) },
    });
    assert.equal(blocked.status, 403);
  });

  it("spends no request at all while the layer is off", async () => {
    const calls = stubJev(() => 0.99);
    rmSync(CONFIG_FILE, { force: true });
    const off = await call({
      method: PROMPT_METHOD,
      params: { session_id: "s1", text: buildKanaUserPrompt(`baca ${SECRET}`) },
    });
    assert.notEqual(off.status, 403);
    assert.notEqual(off.status, 503);
    assert.deepEqual(calls, [], "a disabled guardrail spends no request");
  });
});