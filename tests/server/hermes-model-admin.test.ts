import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  addHermesModel,
  HermesModelError,
  invalidateHermesProviderCache,
  listHermesCustomProviders,
  parseAddModelInput,
} from "@/lib/server/hermes-model-admin";
import { __setTestToken } from "@/lib/server/local-hermes-runtime";

const dataDir = mkdtempSync(path.join(tmpdir(), "kana-model-admin-"));
const previousDataDir = process.env.KANA_DATA_DIR;
process.env.KANA_DATA_DIR = dataDir;

const TOKEN = "model-admin-test-token";
let server: ReturnType<typeof createServer>;
let endpoints: Array<Record<string, unknown>> = [];
let lastPost: Record<string, unknown> | null = null;
let postCount = 0;
let getCount = 0;

async function body(request: import("node:http").IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

function endpoint(id: string, name: string, models: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    base_url: "https://api.example.com/v1",
    model: models[0] ?? "",
    models,
    discover_models: false,
    has_api_key: true,
    api_key_preview: "sk-...abcd",
    source: "providers",
    ...extra,
  };
}

before(async () => {
  server = createServer(async (request, response) => {
    if (request.headers["x-hermes-session-token"] !== TOKEN) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "Unauthorized" }));
      return;
    }
    if (request.url !== "/api/providers/custom-endpoints") {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET") {
      getCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ endpoints, current: { provider: "", model: "", base_url: "" } }));
      return;
    }
    if (request.method === "POST") {
      postCount += 1;
      lastPost = JSON.parse(await body(request)) as Record<string, unknown>;
      if (lastPost.base_url === "https://fail.example.com/v1") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "failed" }));
        return;
      }
      const id = String(
        lastPost.id
        ?? endpoints.find((entry) => entry.name === lastPost?.name)?.id
        ?? String(lastPost.name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
      );
      let entry = endpoints.find((item) => item.id === id);
      if (!entry) {
        entry = endpoint(id, String(lastPost.name), []);
        endpoints.push(entry);
      }
      entry.name = lastPost.name;
      entry.base_url = lastPost.base_url;
      entry.model = lastPost.model;
      entry.models = [...new Set([
        ...(Array.isArray(entry.models) ? entry.models as string[] : []),
        ...(Array.isArray(lastPost.models) ? lastPost.models as string[] : []),
        String(lastPost.model),
      ])];
      entry.has_api_key = Boolean(lastPost.api_key || entry.has_api_key);
      entry.source = "providers";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, id, endpoints, current: { provider: "", model: "", base_url: "" } }));
      return;
    }
    response.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  __setTestToken(TOKEN, port);
});

after(() => {
  server.close();
  if (previousDataDir === undefined) delete process.env.KANA_DATA_DIR;
  else process.env.KANA_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  endpoints = [endpoint("acme", "Acme", ["one"])];
  lastPost = null;
  postCount = 0;
  getCount = 0;
  invalidateHermesProviderCache();
});

describe("Hermes custom model management", () => {
  it("lists providers without key previews or extra endpoint fields", async () => {
    const providers = await listHermesCustomProviders();
    assert.deepEqual(providers, [{
      id: "acme",
      name: "Acme",
      baseUrl: "https://api.example.com/v1",
      models: ["one"],
      hasApiKey: true,
      discoverModels: false,
      source: "providers",
    }]);
    assert.equal(JSON.stringify(providers).includes("sk-"), false);
  });

  it("caches provider reads and refreshes them after a save", async () => {
    await listHermesCustomProviders();
    await listHermesCustomProviders();
    assert.equal(getCount, 1);

    await addHermesModel({ providerId: "acme", model: "two" });
    const refreshed = await listHermesCustomProviders();
    assert.equal(getCount, 2);
    assert.deepEqual(refreshed[0].models, ["one", "two"]);

    await listHermesCustomProviders();
    assert.equal(getCount, 2);
  });

  it("rejects malformed input before Hermes sees it", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["missing model", { name: "P", baseUrl: "https://x.test", model: " " }],
      ["missing name", { baseUrl: "https://x.test", model: "m" }],
      ["bad scheme", { name: "P", baseUrl: "ftp://x.test", model: "m" }],
      ["credentials", { name: "P", baseUrl: "https://user:pass@x.test", model: "m" }],
      ["query", { name: "P", baseUrl: "https://x.test/?a=1", model: "m" }],
      ["fragment", { name: "P", baseUrl: "https://x.test/#frag", model: "m" }],
      ["control character", { name: "P", baseUrl: "https://x.test", model: "m\u0000" }],
      ["long name", { name: "n".repeat(101), baseUrl: "https://x.test", model: "m" }],
      ["long key", { providerId: "acme", model: "m", apiKey: "k".repeat(16_385) }],
      ["zero context", { name: "P", baseUrl: "https://x.test", model: "m", contextLength: 0 }],
      ["fractional context", { name: "P", baseUrl: "https://x.test", model: "m", contextLength: 1.5 }],
      ["invalid provider id", { providerId: "../evil", model: "m" }],
    ];
    for (const [label, input] of cases) {
      assert.throws(
        () => parseAddModelInput(input),
        (error) => error instanceof HermesModelError && error.status === 400,
        label,
      );
    }
  });

  it("normalizes a pasted chat-completions endpoint to its API root", () => {
    for (const [input, expected] of [
      ["https://api.river.ai/v1/chat/completions", "https://api.river.ai/v1"],
      ["https://api.river.ai/v1/chat/completions/", "https://api.river.ai/v1"],
      ["https://api.river.ai/v1/CHAT/COMPLETIONS", "https://api.river.ai/v1"],
      ["https://api.river.ai/chat/completions", "https://api.river.ai"],
      ["https://api.river.ai/v1", "https://api.river.ai/v1"],
      ["https://api.river.ai/v1/chat/completions/extra", "https://api.river.ai/v1/chat/completions/extra"],
    ] as const) {
      assert.equal(
        parseAddModelInput({ name: "River", baseUrl: input, model: "m" }).baseUrl,
        expected,
      );
    }
  });

  it("adds a model to an existing provider and never returns its key", async () => {
    const saved = await addHermesModel({
      providerId: "acme",
      model: "two",
      apiKey: "sk-new-secret",
      contextLength: 4_096,
    });
    assert.deepEqual(lastPost, {
      id: "acme",
      name: "Acme",
      base_url: "https://api.example.com/v1",
      model: "two",
      models: ["one", "two"],
      discover_models: false,
      make_default: false,
      context_length: 4_096,
      api_key: "sk-new-secret",
    });
    assert.deepEqual(saved, {
      id: "acme",
      name: "Acme",
      baseUrl: "https://api.example.com/v1",
      models: ["one", "two"],
      hasApiKey: true,
      discoverModels: false,
      source: "providers",
    });
    assert.equal(JSON.stringify(saved).includes("sk-new-secret"), false);
  });

  it("replaces an existing provider's name and base URL without touching its key", async () => {
    const saved = await addHermesModel({
      providerId: "acme",
      name: "River AI",
      baseUrl: "https://api.river.ai/v1/chat/completions",
      model: "one",
    });
    assert.deepEqual(lastPost, {
      id: "acme",
      name: "River AI",
      base_url: "https://api.river.ai/v1",
      model: "one",
      models: ["one"],
      discover_models: false,
      make_default: false,
    });
    assert.deepEqual(saved, {
      id: "acme",
      name: "River AI",
      baseUrl: "https://api.river.ai/v1",
      models: ["one"],
      hasApiKey: true,
      discoverModels: false,
      source: "providers",
    });
  });

  it("creates a new provider without sending an empty key", async () => {
    const saved = await addHermesModel({
      name: "Local",
      baseUrl: "http://127.0.0.1:8080/v1///",
      model: "local-1",
      apiKey: "",
    });
    assert.deepEqual(lastPost, {
      name: "Local",
      base_url: "http://127.0.0.1:8080/v1",
      model: "local-1",
      models: ["local-1"],
      discover_models: false,
      make_default: false,
    });
    assert.deepEqual(saved.models, ["local-1"]);
    assert.equal(saved.source, "providers");
  });

  it("requires a fresh key before a direct-config endpoint loses its credential", async () => {
    endpoints = [endpoint("custom", "Custom", ["current"], { source: "direct-config" })];
    await assert.rejects(
      addHermesModel({ providerId: "custom", model: "another" }),
      (error) => error instanceof HermesModelError
        && error.status === 400
        && /API key/.test(error.message),
    );
    assert.equal(postCount, 0);

    const saved = await addHermesModel({
      providerId: "custom",
      model: "another",
      apiKey: "sk-direct",
    });
    assert.equal(lastPost?.api_key, "sk-direct");
    assert.deepEqual(saved.models, ["current", "another"]);
    assert.equal(JSON.stringify(saved).includes("sk-direct"), false);
  });

  it("reports an unreachable dashboard without echoing the request", async () => {
    await assert.rejects(
      addHermesModel({
        name: "Fail",
        baseUrl: "https://fail.example.com/v1",
        model: "m",
        apiKey: "sk-do-not-echo",
      }),
      (error) => error instanceof HermesModelError
        && error.status === 502
        && !error.message.includes("sk-do-not-echo"),
    );
  });
});
