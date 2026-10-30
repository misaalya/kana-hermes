import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";
import { createKanaStores } from "@/lib/store/kana-stores";
import { ModelDefaultsService } from "@/lib/services/model-defaults-service";
import { PreferencesAccess } from "@/lib/services/preferences-service";

function harness(local: Record<string, { provider: string; model: string }>) {
  const stores = createKanaStores();
  const preferences = new PreferencesAccess(stores.preferences, {
    load: () => ({ ...DEFAULT_PREFERENCES, agentModelDefaults: local }),
    save: () => {},
    consumeWarning: () => null,
  });
  preferences.adopt({ ...DEFAULT_PREFERENCES, agentModelDefaults: local });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue: Array<{ status?: number; json?: unknown; fail?: boolean }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next || next.fail) throw new Error("server unavailable");
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.json,
    } as Response;
  }) as typeof fetch;
  const service = new ModelDefaultsService({ preferences, fetch: fetchImpl });
  return { preferences, calls, queue, service };
}

describe("ModelDefaultsService", () => {
  it("adopts the installation map before the first session", async () => {
    const { preferences, queue, service } = harness({
      local: { provider: "legacy", model: "old" },
    });
    queue.push({
      json: {
        defaults: {
          local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
        },
      },
    });

    await service.hydrate();

    assert.deepEqual(preferences.current().agentModelDefaults, {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    });
  });

  it("migrates a legacy browser map once when the server has none", async () => {
    const local = {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    };
    const { preferences, calls, queue, service } = harness(local);
    queue.push({ json: { defaults: {} } }, { json: { defaults: local } });

    await service.hydrate();

    assert.deepEqual(preferences.current().agentModelDefaults, local);
    const put = calls.find((call) => call.init?.method === "PUT");
    assert.ok(put, "the legacy map is written to the server");
    assert.deepEqual(JSON.parse(String(put.init?.body)), { defaults: local });
  });

  it("keeps the legacy map when the server cannot be read", async () => {
    const local = {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    };
    const { preferences, calls, queue, service } = harness(local);
    queue.push({ fail: true });

    await service.hydrate();

    assert.deepEqual(preferences.current().agentModelDefaults, local);
    assert.equal(calls.filter((call) => call.init?.method === "PUT").length, 0);
  });

  it("writes the whole map and reports a failed save", async () => {
    const { calls, queue, service } = harness({});
    const defaults = {
      local: { provider: " openrouter ", model: " deepseek/deepseek-v4 " },
    };
    queue.push({ json: { defaults } });
    await service.save(defaults);
    const put = calls.find((call) => call.init?.method === "PUT");
    assert.deepEqual(JSON.parse(String(put?.init?.body)), {
      defaults: {
        local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
      },
    });

    queue.push({ status: 500, json: { error: "no" } });
    await assert.rejects(() => service.save(defaults), /could not be saved/);
  });
});
