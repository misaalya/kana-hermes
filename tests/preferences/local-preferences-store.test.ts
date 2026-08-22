import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PREFERENCES,
  LocalPreferencesStore,
} from "@/lib/preferences/local-preferences-store";
import { SessionHermesCredentialsStore } from "@/lib/preferences/session-hermes-credentials-store";

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
  it("keeps the Hermes token out of persistent local storage", () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(session),
    );

    store.save({
      ...DEFAULT_PREFERENCES,
      agentMode: "hermes",
      hermes: {
        ...DEFAULT_PREFERENCES.hermes,
        token: "super-secret-dashboard-token",
      },
    });

    const raw = persistent.getItem("kana.preferences.v5");
    assert.ok(raw);
    assert.equal(raw.includes("super-secret-dashboard-token"), false);
    assert.equal(store.load().hermes.token, "super-secret-dashboard-token");
  });

  it("moves a legacy v2 token into session storage and removes the old record", () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
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
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(session),
    );

    const loaded = store.load();

    assert.equal(loaded.hermes.token, "legacy-token");
    assert.equal(loaded.subtitleLanguage, "id");
    assert.equal(persistent.getItem("kana.preferences.v2"), null);
    assert.equal(
      persistent.getItem("kana.preferences.v5")?.includes("legacy-token"),
      false,
    );
    assert.equal(loaded.onboardingCompleted, true);
  });

  it("keeps onboarding open only for a genuinely new browser profile", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(new MemoryStorage()),
    );

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
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(new MemoryStorage()),
    );

    const loaded = store.load();

    assert.equal(loaded.subtitleLanguage, "ja");
    assert.equal(loaded.qwen3Tts.deliveryMode, "complete");
    assert.equal(persistent.getItem("kana.preferences.v4"), null);
    assert.ok(persistent.getItem("kana.preferences.v5"));
  });

  it("moves a token embedded in a legacy WebSocket URL into tab storage", () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v3",
      JSON.stringify({
        hermes: {
          websocketUrl: "ws://127.0.0.1:9119/api/ws?token=legacy-query-secret",
        },
      }),
    );
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(session),
    );

    const loaded = store.load();
    const persisted = persistent.getItem("kana.preferences.v5") ?? "";
    assert.equal(loaded.hermes.token, "legacy-query-secret");
    assert.equal(loaded.hermes.websocketUrl.includes("token="), false);
    assert.equal(persisted.includes("legacy-query-secret"), false);
  });

  it("does not persist executable, credential, or insecure provider URLs", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(new MemoryStorage()),
    );
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
    const store = new LocalPreferencesStore(
      persistent,
      new SessionHermesCredentialsStore(new MemoryStorage()),
    );

    assert.equal(store.load().agentMode, "mock");
    assert.equal(persistent.getItem("kana.preferences.v2"), "{not valid JSON");
    assert.match(store.consumeWarning() ?? "", /kept for recovery/i);
    assert.equal(store.consumeWarning(), null);
  });
});
