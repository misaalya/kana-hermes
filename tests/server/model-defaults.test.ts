import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { resetAppStateStoreForTests, setAppState } from "@/lib/server/app-state-store";
import {
  MODEL_DEFAULTS_APP_STATE_KEY,
  parseModelDefaults,
  readModelDefaults,
  writeModelDefaults,
} from "@/lib/server/model-defaults";

const dataDir = mkdtempSync(path.join(tmpdir(), "kana-model-defaults-"));
process.env.KANA_DATA_DIR = dataDir;

after(() => {
  resetAppStateStoreForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("installation model defaults", () => {
  beforeEach(() => {
    resetAppStateStoreForTests();
  });

  it("accepts a well-formed per-runtime map and trims its values", () => {
    assert.deepEqual(
      parseModelDefaults({
        local: { provider: " openrouter ", model: " deepseek/deepseek-v4 " },
        "remote-0123456789abcdef": { provider: "custom:9router", model: "gpt-5" },
      }),
      {
        local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
        "remote-0123456789abcdef": { provider: "custom:9router", model: "gpt-5" },
      },
    );
  });

  it("rejects malformed maps whole instead of silently dropping entries", () => {
    for (const value of [
      null,
      [],
      { local: { provider: "openrouter" } },
      { "not-a-runtime": { provider: "openrouter", model: "m" } },
      { local: { provider: "  ", model: "m" } },
      { local: { provider: "p", model: "m", extra: true } },
    ]) {
      assert.equal(parseModelDefaults(value), null);
    }
  });

  it("stores the map in appstate.db and survives a store reset", () => {
    writeModelDefaults({
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    });
    assert.deepEqual(readModelDefaults(), {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    });

    resetAppStateStoreForTests();
    assert.deepEqual(readModelDefaults(), {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    });
  });

  it("reads corrupt or foreign state as empty", () => {
    setAppState(MODEL_DEFAULTS_APP_STATE_KEY, { local: { provider: "", model: "m" } });
    assert.deepEqual(readModelDefaults(), {});
  });
});
