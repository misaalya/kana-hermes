import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PREFERENCES,
  LocalPreferencesStore,
} from "@/lib/preferences/local-preferences-store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("LocalPreferencesStore", () => {
  it("stores no Hermes connection credentials at all", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);

    store.save({ ...DEFAULT_PREFERENCES });

    const raw = persistent.getItem("kana.preferences.v5") ?? "";
    assert.ok(raw);
    assert.equal(raw.includes("token"), false);
    assert.equal(raw.includes("websocketUrl"), false);
    assert.equal(raw.includes("ws://"), false);
  });

  it("drops legacy token and websocket fields when migrating old records", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v2",
      JSON.stringify({
        subtitleLanguage: "id",
        hermes: {
          websocketUrl: "ws://127.0.0.1:9123/api/ws",
          token: "legacy-token",
          cwd: "/tmp/kana",
        },
      }),
    );
    const store = new LocalPreferencesStore(persistent);

    const loaded = store.load();

    assert.equal(loaded.subtitleLanguage, "id");
    assert.equal(loaded.hermes.cwd, "/tmp/kana");
    assert.equal(persistent.getItem("kana.preferences.v2"), null);
    const persisted = persistent.getItem("kana.preferences.v5") ?? "";
    assert.equal(persisted.includes("legacy-token"), false);
    assert.equal(persisted.includes("ws://127.0.0.1"), false);
    assert.equal(loaded.onboardingCompleted, true);
  });

  it("keeps onboarding open only for a genuinely new browser profile", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);

    assert.equal(store.load().onboardingCompleted, false);
    store.save({ ...DEFAULT_PREFERENCES, onboardingCompleted: true });
    assert.equal(store.load().onboardingCompleted, true);
  });

  it("migrates v4 preferences to complete speech delivery without changing existing choices", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v4",
      JSON.stringify({
        onboardingCompleted: true,
        subtitleLanguage: "ja",
        qwen3Tts: {
          baseUrl: "http://127.0.0.1:7860",
          voiceId: "ono_anna",
        },
      }),
    );
    const store = new LocalPreferencesStore(persistent);

    const loaded = store.load();

    assert.equal(loaded.subtitleLanguage, "ja");
    assert.equal(loaded.qwen3Tts.deliveryMode, "complete");
    assert.equal(persistent.getItem("kana.preferences.v4"), null);
    assert.ok(persistent.getItem("kana.preferences.v5"));
  });

  it("strips a token embedded in a legacy WebSocket URL during migration", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v3",
      JSON.stringify({
        hermes: {
          websocketUrl: "ws://127.0.0.1:9119/api/ws?token=legacy-query-secret",
        },
      }),
    );
    const store = new LocalPreferencesStore(persistent);

    store.load();

    const persisted = persistent.getItem("kana.preferences.v5") ?? "";
    assert.equal(persisted.includes("legacy-query-secret"), false);
    assert.equal(persisted.includes("websocketUrl"), false);
  });

  it("does not persist executable, credential, or insecure provider URLs", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);
    store.save(DEFAULT_PREFERENCES);
    assert.throws(() =>
      store.save({
        ...DEFAULT_PREFERENCES,
        qwen3Tts: {
          ...DEFAULT_PREFERENCES.qwen3Tts,
          baseUrl: "http://secret@example.com:7860",
        },
        live2d: {
          ...DEFAULT_PREFERENCES.live2d,
          modelUrl: "javascript:alert(1)",
          coreScriptUrl: "https://example.com/arbitrary.js",
          hostedModels: [
            { id: "bad", name: "Bad", url: "javascript:alert(2)", addedAt: 1 },
          ],
        },
      }),
    );
    const persisted = persistent.getItem("kana.preferences.v5") ?? "";
    assert.equal(persisted.includes("secret@example.com"), false);
    assert.equal(persisted.includes("javascript:"), false);
    assert.equal(persisted.includes("arbitrary.js"), false);
  });

  it("keeps an unreadable legacy record available for manual recovery", () => {
    const persistent = new MemoryStorage();
    persistent.setItem("kana.preferences.v2", "{not valid JSON");
    const store = new LocalPreferencesStore(persistent);

    assert.equal(store.load().agentMode, "hermes");
    assert.equal(persistent.getItem("kana.preferences.v2"), "{not valid JSON");
    assert.match(store.consumeWarning() ?? "", /kept for recovery/i);
    assert.equal(store.consumeWarning(), null);
  });
});
