import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentModelCatalog } from "@/lib/agent/types";
import { createHarness, tick } from "./workspace-harness";

const catalog = (model: string, providers = ["openrouter"]): AgentModelCatalog => ({
  provider: providers[0],
  model,
  providers: providers.map((slug) => ({ slug, name: slug, models: [model], current: true, authenticated: true })),
});

async function connectedHarness() {
  const harness = createHarness({ setupAgent: (agent) => (agent.models = catalog("m1")) });
  harness.conversations.initialize();
  await harness.sessions.ensure(harness.active());
  return harness;
}

describe("ModelCatalogService", () => {
  it("loads once, then answers pickers from the cache and refreshes in the background", async () => {
    const harness = await connectedHarness();
    const first = await harness.models.list();
    assert.equal(first.model, "m1");
    assert.deepEqual(harness.agent.modelLists, [false]);

    harness.agent.models = catalog("m1", ["openrouter", "deepseek"]);
    const cached = await harness.models.list();
    assert.equal(cached, first, "the cached catalog is returned without waiting for Hermes");
    await tick();
    assert.equal(harness.agent.modelLists.length, 2, "one background refresh");
    assert.equal(harness.stores.models.getState().entry?.catalog.providers.length, 2, "config changes still arrive");
  });

  it("does not replace an unchanged catalog, so subscribers do not re-render", async () => {
    const harness = await connectedHarness();
    await harness.models.list();
    const entry = harness.stores.models.getState().entry;
    harness.agent.models = catalog("m1");
    await harness.models.list();
    await tick();
    assert.equal(harness.stores.models.getState().entry, entry);
  });

  it("completes /model arguments from the cache without another model.options call", async () => {
    const harness = await connectedHarness();
    await harness.models.list();
    await harness.commands.complete("/model de");
    await harness.commands.complete("/model dee");
    assert.deepEqual(harness.agent.modelLists, [false]);
    assert.equal(harness.agent.completionModels?.model, "m1");
  });

  it("joins concurrent loads into one request", async () => {
    const harness = await connectedHarness();
    const [a, b] = await Promise.all([harness.models.get(), harness.models.list()]);
    assert.equal(a, b);
    assert.deepEqual(harness.agent.modelLists, [false]);
  });

  it("waits for a full reload when the user asks to refresh", async () => {
    const harness = await connectedHarness();
    await harness.models.list();
    harness.agent.models = catalog("m2");
    const refreshed = await harness.models.list(true);
    assert.equal(refreshed.model, "m2");
    assert.deepEqual(harness.agent.modelLists, [false, true]);
  });

  it("drops the catalog when /model changes the session's model", async () => {
    const harness = await connectedHarness();
    await harness.models.list();
    await harness.send("/model m2 --provider openrouter --session");
    assert.equal(harness.stores.models.getState().entry, null);
  });

  it("drops the catalog when the connection is lost and reloads for a new session", async () => {
    const harness = await connectedHarness();
    await harness.models.list();
    harness.agent.emit({ type: "connection.changed", state: "reconnecting", retryAttempt: 1 });
    assert.equal(harness.stores.models.getState().entry, null);

    harness.agent.emit({ type: "connection.changed", state: "connected" });
    await harness.models.list();
    harness.agent.models = catalog("m3");
    harness.agent.emit({ type: "session.opened", sessionId: "runtime-9", persistentSessionId: "hermes-session-9", resumed: false });
    await tick();
    assert.equal(harness.stores.models.getState().entry?.key, "runtime-9");
    assert.equal(harness.stores.models.getState().entry?.catalog.model, "m3");
  });

  it("ignores a response that arrives after the catalog was dropped", async () => {
    const harness = await connectedHarness();
    const pending = harness.models.list();
    harness.models.invalidate();
    await pending;
    assert.equal(harness.stores.models.getState().entry, null);
  });
});
