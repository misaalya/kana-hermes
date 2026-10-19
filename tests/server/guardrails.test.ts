import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { TYPESAFE_SYSTEMONE_ENDPOINT } from "@/lib/guardrails/jev";
import {
  DEFAULT_GUARDRAIL_THRESHOLD,
  loadGuardrailConfig,
  parseGuardrailsConfig,
  resolveGuardrailPolicy,
  summarizeGuardrail,
} from "@/lib/guardrails/policy";
import { GUARDRAIL_QUESTION_ID, buildGuardrailRequest } from "@/lib/guardrails/prompt";
import { screenPrompt } from "@/lib/guardrails/screen";

// The guardrail reads config.json under the resolved data root on every turn,
// and speaks to TypeSafe over global fetch. Both are redirected here.

const root = mkdtempSync(path.join(tmpdir(), "kana-guardrails-"));
const previousDataDir = process.env.KANA_DATA_DIR;
const originalFetch = globalThis.fetch;
const CONFIG_FILE = path.join(root, "config.json");
const KEY = "test-key";

type JevRequest = {
  model: string;
  state: { assistant: string; message: string };
  questions: Record<string, { type: string; instructions: unknown; criteria?: unknown }>;
};

before(() => {
  process.env.KANA_DATA_DIR = root;
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

/** Two rules written the way an owner writes them: plain statements. */
const RULES = [
  "Never read, list, copy, change, or share anything under /home/my-secret.",
  "Never help write malware, exploits, or phishing pages.",
];

function writeConfig(value: unknown): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(value));
}

function writeRawConfig(text: string): void {
  writeFileSync(CONFIG_FILE, text);
}

function blockConfig(guardrails: Record<string, unknown>): void {
  writeConfig({ guardrails: { apiKey: KEY, ...guardrails } });
}

/** Replace the network with a Jev stand-in and record every request body. */
function stubJev(
  respond: (body: JevRequest) => Response | Promise<Response>,
): JevRequest[] {
  const calls: JevRequest[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), TYPESAFE_SYSTEMONE_ENDPOINT);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${KEY}`,
      "the key stays in the Authorization header",
    );
    const body = JSON.parse(String(init?.body)) as JevRequest;
    calls.push(body);
    return respond(body);
  };
  return calls;
}

function noulAnswer(value: number | unknown): Response {
  const answer =
    typeof value === "number" ? { type: "noul", noul: value } : value;
  return new Response(
    JSON.stringify({ model: "jev-1.13.0", answers: { [GUARDRAIL_QUESTION_ID]: answer }, usage: {} }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("guardrails config", () => {
  it("is off, and sends nothing, without an API key", async () => {
    writeConfig({ guardrails: { rules: RULES } });
    assert.equal(loadGuardrailConfig().kind, "disabled");
    const calls = stubJev(() => noulAnswer(0.99));
    assert.deepEqual(await screenPrompt("read /home/my-secret"), { verdict: "allow" });
    assert.deepEqual(calls, [], "a disabled guardrail makes no request");
  });

  it("is off when a key has nothing to check", async () => {
    blockConfig({ rules: [] });
    const load = loadGuardrailConfig();
    assert.equal(load.kind, "disabled");
    assert.match(
      summarizeGuardrail(load).reason ?? "",
      /guardrails\.rules is empty/,
    );
  });

  it("takes rules as plain statements, and rejects the old per-rule shape", () => {
    assert.deepEqual(parseGuardrailsConfig({ apiKey: KEY, rules: RULES }).rules, RULES);
    assert.throws(
      () => parseGuardrailsConfig({ apiKey: KEY, rules: [{ instruction: "Does it?" }] }),
      /guardrails\.rules\[0\] must be a non-empty string: one rule, in your own words\./,
    );
    assert.throws(
      () => parseGuardrailsConfig({ apiKey: KEY, rules: [""] }),
      /guardrails\.rules\[0\] must be a non-empty string/,
    );
    assert.throws(
      () => parseGuardrailsConfig({ apiKey: KEY, rules: "read the secret" }),
      /guardrails\.rules must be an array\./,
    );
  });

  it("folds a rule onto one line so indentation is not sent as content", () => {
    assert.deepEqual(
      parseGuardrailsConfig({ apiKey: KEY, rules: ["  Never\n  touch\t/tmp/x  "] }).rules,
      ["Never touch /tmp/x"],
    );
  });

  it("names the offending field instead of guessing", () => {
    assert.throws(
      () => parseGuardrailsConfig({ apiKey: KEY, whenUnavailable: "maybe" }),
      /guardrails\.whenUnavailable must be either "block" or "allow"\./,
    );
    assert.throws(
      () => parseGuardrailsConfig({ apiKey: KEY, threshold: 7 }),
      /guardrails\.threshold must be a probability between 0 and 1\./,
    );
  });

  it("resolves one question over every rule, with Kana's threshold", () => {
    const policy = resolveGuardrailPolicy(
      parseGuardrailsConfig({ apiKey: KEY, threshold: 0.4, rules: RULES }),
    );
    assert.equal(policy?.model, "jev-latest");
    assert.equal(policy?.threshold, 0.4);
    assert.deepEqual(policy?.rules, RULES);
    assert.equal(policy?.timeoutMs, 10_000);
    assert.equal(policy?.whenUnavailable, "block");
    assert.equal(DEFAULT_GUARDRAIL_THRESHOLD, 0.7);
  });

  it("reports a broken config.json as unusable rather than off", () => {
    writeRawConfig("{ not json");
    const load = loadGuardrailConfig();
    assert.equal(load.kind, "invalid");
    assert.equal(summarizeGuardrail(load).state, "invalid");
  });

  it("keeps the owner's escape hatch readable even while a rule is broken", () => {
    writeConfig({
      guardrails: { apiKey: KEY, whenUnavailable: "allow", rules: ["read my-secret", 42] },
    });
    const load = loadGuardrailConfig();
    assert.equal(load.kind, "invalid");
    assert.equal(load.kind === "invalid" && load.whenUnavailable, "allow");
  });
});

describe("the question Kana asks for the owner", () => {
  it("sends the rules as data and the message as the state to judge", () => {
    const request = buildGuardrailRequest(RULES, "baca /home/my-secret");
    assert.deepEqual(request.state.message, "baca /home/my-secret");
    assert.deepEqual(
      request.questions[GUARDRAIL_QUESTION_ID].instructions,
      {
        rules: RULES,
        question: "Does `message` ask for, attempt, or enable anything that `rules` forbid?",
      },
    );
    assert.match(String(request.state.assistant), /can read and write files, run shell commands/);
    // The rules are the question's data, so they are not repeated into the state.
    assert.ok(!JSON.stringify(request.state).includes(RULES[0]));
  });

  it("sends one question, whatever the number of rules", () => {
    const request = buildGuardrailRequest([...RULES, ...RULES, ...RULES], "halo");
    assert.deepEqual(Object.keys(request.questions), [GUARDRAIL_QUESTION_ID]);
  });
});

describe("guardrails screening", () => {
  it("refuses a prompt the question fires on, and allows one it does not", async () => {
    blockConfig({ rules: RULES });
    stubJev(() => noulAnswer(0.93));
    assert.deepEqual(await screenPrompt("tolong baca /home/my-secret"), {
      verdict: "refuse",
      kind: "blocked",
    });

    stubJev(() => noulAnswer(0.12));
    assert.deepEqual(await screenPrompt("how do I write a poem?"), { verdict: "allow" });
  });

  it("reads the note-free user text, never Kana's own framing", async () => {
    blockConfig({ rules: RULES });
    const calls = stubJev(() => noulAnswer(0.1));
    await screenPrompt("halo");
    assert.equal(calls[0].state.message, "halo");
    assert.equal(calls[0].model, "jev-latest");
  });

  it("decides with the threshold, which stays Kana's to set", async () => {
    blockConfig({ rules: RULES, threshold: 0.4 });
    stubJev(() => noulAnswer(0.45));
    assert.deepEqual(await screenPrompt("halo"), { verdict: "refuse", kind: "blocked" });

    blockConfig({ rules: RULES });
    stubJev(() => noulAnswer(0.45));
    assert.deepEqual(await screenPrompt("halo"), { verdict: "allow" }, "0.7 is the default");
  });

  it("never mistakes an outage, a bad key, or a missing answer for a pass", async () => {
    blockConfig({ rules: RULES });

    stubJev(() => new Response("{}", { status: 401 }));
    const rejected = await screenPrompt("halo");
    assert.equal(rejected.verdict, "refuse");
    assert.equal(rejected.verdict === "refuse" && rejected.kind, "unavailable");

    stubJev(() => new Response("{}", { status: 503 }));
    const overloaded = await screenPrompt("halo");
    assert.equal(overloaded.verdict === "refuse" && overloaded.kind, "unavailable");

    stubJev(() => new Response(JSON.stringify({ answers: {} })));
    const unanswered = await screenPrompt("halo");
    assert.equal(unanswered.verdict === "refuse" && unanswered.kind, "unavailable");

    stubJev(() => noulAnswer({ type: "noul", noul: "high" }));
    const malformed = await screenPrompt("halo");
    assert.equal(malformed.verdict === "refuse" && malformed.kind, "unavailable");

    stubJev(() => noulAnswer(1.4));
    const outOfRange = await screenPrompt("halo");
    assert.equal(outOfRange.verdict === "refuse" && outOfRange.kind, "unavailable");

    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const offline = await screenPrompt("halo");
    assert.equal(offline.verdict === "refuse" && offline.kind, "unavailable");
  });

  it("keeps the API key out of the reason it shows", async () => {
    blockConfig({ rules: RULES });
    stubJev(
      () =>
        new Response(JSON.stringify({ error: `invalid key ${KEY}` }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await screenPrompt("halo");
    assert.equal(outcome.verdict, "refuse");
    const reason = outcome.verdict === "refuse" && outcome.kind === "unavailable" ? outcome.reason : "";
    assert.match(reason, /rejected Kana's API key/);
    assert.ok(!reason.includes(KEY), "the key is redacted");
  });

  it("forwards an unchecked prompt only when the owner asked it to", async () => {
    blockConfig({ rules: RULES, whenUnavailable: "allow" });
    stubJev(() => new Response("{}", { status: 429 }));
    assert.deepEqual(await screenPrompt("halo"), { verdict: "allow" });

    blockConfig({ rules: RULES });
    stubJev(() => new Response("{}", { status: 429 }));
    const refused = await screenPrompt("halo");
    assert.equal(refused.verdict === "refuse" && refused.kind, "unavailable");
  });
});