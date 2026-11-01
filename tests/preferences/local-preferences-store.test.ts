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

    const raw = persistent.getItem("kana.preferences.v6") ?? "";
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

    // The retired subtitle language setting is dropped on migration.
    assert.equal("subtitleLanguage" in loaded, false);
    assert.equal(loaded.hermes.cwd, "/tmp/kana");
    assert.equal(persistent.getItem("kana.preferences.v2"), null);
    const persisted = persistent.getItem("kana.preferences.v6") ?? "";
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

  it("persists the selected Kana stage background", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);

    store.save({
      ...DEFAULT_PREFERENCES,
      stageBackground: "pattern-seigaiha",
    });

    assert.equal(store.load().stageBackground, "pattern-seigaiha");
  });

  it("persists and sanitizes a layout independently for each Live2D model", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);
    const sourceKey = `url:${DEFAULT_PREFERENCES.live2d.modelUrl}`;

    store.save({
      ...DEFAULT_PREFERENCES,
      live2d: {
        ...DEFAULT_PREFERENCES.live2d,
        layoutProfiles: {
          [sourceKey]: { x: 4, y: -4, scale: 99 },
          "import:another-avatar": { x: 0.12, y: 0.08, scale: 1.25 },
        },
      },
    });

    const loaded = store.load();
    assert.deepEqual(loaded.live2d.layoutProfiles?.[sourceKey], {
      x: 0.75,
      y: -0.75,
      scale: 2.5,
    });
    assert.deepEqual(
      loaded.live2d.layoutProfiles?.["import:another-avatar"],
      { x: 0.12, y: 0.08, scale: 1.25 },
    );
  });

  it("reads a legacy browser default for migration but never stores it", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);
    assert.deepEqual(store.load().agentModelDefaults, {});

    // A record written by an older build still hands the map to the
    // workspace, which migrates it to the server once...
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({
        agentModelDefaults: {
          local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
          "remote-0123456789abcdef": { provider: "custom:9router", model: "gpt-5" },
          "not-a-runtime": { provider: "openrouter", model: "deepseek/deepseek-v4" },
        },
      }),
    );
    assert.deepEqual(store.load().agentModelDefaults, {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
      "remote-0123456789abcdef": { provider: "custom:9router", model: "gpt-5" },
    });
    // ...and the browser copy is gone after the load rewrites the record.
    const rewritten = JSON.parse(persistent.getItem("kana.preferences.v6") ?? "{}") as {
      agentModelDefaults?: unknown;
    };
    assert.equal(rewritten.agentModelDefaults, undefined);
    assert.deepEqual(store.load().agentModelDefaults, {});

    // Saving a preferences object never writes the map to localStorage; the
    // in-memory copy is what the UI and session manager use.
    store.save({
      ...DEFAULT_PREFERENCES,
      agentModelDefaults: {
        local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
      },
    });
    assert.equal(
      persistent.getItem("kana.preferences.v6")?.includes("agentModelDefaults"),
      false,
    );
    assert.deepEqual(store.load().agentModelDefaults, {});
  });

  it("migrates the one global default model to the local runtime in memory", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v5",
      JSON.stringify({ defaultAgentModel: { provider: "openrouter", model: "deepseek/deepseek-v4" } }),
    );
    const store = new LocalPreferencesStore(persistent);
    assert.deepEqual(store.load().agentModelDefaults, {
      local: { provider: "openrouter", model: "deepseek/deepseek-v4" },
    });
    const persisted = persistent.getItem("kana.preferences.v6") ?? "";
    assert.equal(persisted.includes("defaultAgentModel"), false);
    assert.equal(persisted.includes("agentModelDefaults"), false);
    assert.equal(persistent.getItem("kana.preferences.v5"), null);
  });

  it("keeps the chatbar collapse delay within 0-600 seconds", () => {
    const persistent = new MemoryStorage();
    // A record from a build without the setting starts at 30 seconds.
    persistent.setItem("kana.preferences.v6", JSON.stringify({ uiLocale: "en" }));
    assert.equal(
      new LocalPreferencesStore(persistent).load().composerCollapseDelaySeconds,
      30,
    );
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({ uiLocale: "en", composerCollapseDelaySeconds: -5 }),
    );
    assert.equal(
      new LocalPreferencesStore(persistent).load().composerCollapseDelaySeconds,
      0,
    );

    const store = new LocalPreferencesStore(persistent);
    store.save({ ...DEFAULT_PREFERENCES, composerCollapseDelaySeconds: 240.6 });
    assert.equal(store.load().composerCollapseDelaySeconds, 241);
    store.save({ ...DEFAULT_PREFERENCES, composerCollapseDelaySeconds: 9_999 });
    assert.equal(store.load().composerCollapseDelaySeconds, 600);
  });

  it("keeps a dragged chat panel width within bounds", () => {
    const persistent = new MemoryStorage();
    persistent.setItem("kana.preferences.v6", JSON.stringify({ uiLocale: "en" }));
    assert.equal(new LocalPreferencesStore(persistent).load().chatPanelWidth, 0);

    const store = new LocalPreferencesStore(persistent);
    store.save({ ...DEFAULT_PREFERENCES, chatPanelWidth: 512 });
    assert.equal(store.load().chatPanelWidth, 512);
    store.save({ ...DEFAULT_PREFERENCES, chatPanelWidth: 9_999 });
    assert.equal(store.load().chatPanelWidth, 4_096);
    store.save({ ...DEFAULT_PREFERENCES, chatPanelWidth: -1 });
    assert.equal(store.load().chatPanelWidth, 0);
  });

  it("keeps a complete header host layout or falls back to the default", () => {
    const persistent = new MemoryStorage();
    persistent.setItem("kana.preferences.v6", JSON.stringify({ uiLocale: "en" }));
    assert.deepEqual(
      new LocalPreferencesStore(persistent).load().hostWidgetLayout,
      { left: ["monitor"], center: ["time"], right: ["date"] },
    );
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({
        uiLocale: "en",
        hostWidgetLayout: {
          left: ["date", "monitor"],
          center: [],
          right: ["time"],
        },
      }),
    );
    assert.deepEqual(
      new LocalPreferencesStore(persistent).load().hostWidgetLayout,
      { left: ["date", "monitor"], center: [], right: ["time"] },
    );
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({
        uiLocale: "en",
        hostWidgetLayout: { left: ["monitor"], center: ["date"], right: [] },
      }),
    );
    assert.deepEqual(
      new LocalPreferencesStore(persistent).load().hostWidgetLayout,
      { left: ["monitor"], center: ["time"], right: ["date"] },
    );
  });

  it("falls back safely when a stored stage background is unknown", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({ stageBackground: "future-unknown-pattern" }),
    );

    const store = new LocalPreferencesStore(persistent);

    assert.equal(store.load().stageBackground, "plain");
  });

  it("persists a local background id without embedding its image", () => {
    const persistent = new MemoryStorage();
    const store = new LocalPreferencesStore(persistent);

    store.save({
      ...DEFAULT_PREFERENCES,
      stageBackground: "custom",
      customBackgroundId: "background-local-1",
    });

    const loaded = store.load();
    assert.equal(loaded.stageBackground, "custom");
    assert.equal(loaded.customBackgroundId, "background-local-1");
    assert.equal((persistent.getItem("kana.preferences.v6") ?? "").includes("data:image"), false);
  });

  it("starts with voice off, since local speech needs an explicit engine download", () => {
    const loaded = new LocalPreferencesStore(new MemoryStorage()).load();
    assert.equal(loaded.voiceEnabled, false);
    assert.deepEqual(loaded.voice, { voiceId: "", deliveryMode: "complete" });
  });

  it("migrates v4 preferences to complete speech delivery without changing existing choices", () => {
    const persistent = new MemoryStorage();
    persistent.setItem(
      "kana.preferences.v4",
      JSON.stringify({
        onboardingCompleted: true,
        voiceEnabled: true,
        subtitleLanguage: "ja",
        qwen3Tts: {
          baseUrl: "http://127.0.0.1:7860",
          voiceId: "ono_anna",
        },
      }),
    );
    const store = new LocalPreferencesStore(persistent);

    const loaded = store.load();

    assert.equal("subtitleLanguage" in loaded, false);
    assert.equal("qwen3Tts" in loaded, false);
    // Qwen voice ids named service-side profiles; the bundled Kana voice is used instead.
    assert.deepEqual(loaded.voice, { voiceId: "", deliveryMode: "complete" });
    assert.equal(loaded.voiceEnabled, true, "an existing voice choice is kept");
    assert.equal((persistent.getItem("kana.preferences.v6") ?? "").includes("7860"), false);
    assert.equal(persistent.getItem("kana.preferences.v4"), null);
    assert.ok(persistent.getItem("kana.preferences.v6"));
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

    const persisted = persistent.getItem("kana.preferences.v6") ?? "";
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
    const persisted = persistent.getItem("kana.preferences.v6") ?? "";
    assert.equal(persisted.includes("javascript:"), false);
    assert.equal(persisted.includes("arbitrary.js"), false);
  });

  it("keeps auto scroll on unless the user turned it off", () => {
    const persistent = new MemoryStorage();
    persistent.setItem("kana.preferences.v6", JSON.stringify({ uiLocale: "en" }));
    assert.equal(new LocalPreferencesStore(persistent).load().autoScroll, true);
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({ uiLocale: "en", autoScroll: "no" }),
    );
    assert.equal(new LocalPreferencesStore(persistent).load().autoScroll, true);

    const store = new LocalPreferencesStore(persistent);
    store.save({ ...DEFAULT_PREFERENCES, autoScroll: false });
    assert.equal(store.load().autoScroll, false);
  });

  it("keeps the stage on unless the user switched it off", () => {
    const persistent = new MemoryStorage();
    // A record from a build without the setting, and a tampered value, both
    // stay a chat-and-avatar workspace.
    persistent.setItem("kana.preferences.v6", JSON.stringify({ uiLocale: "en" }));
    assert.equal(new LocalPreferencesStore(persistent).load().avatarVisible, true);
    persistent.setItem(
      "kana.preferences.v6",
      JSON.stringify({ uiLocale: "en", avatarVisible: "no" }),
    );
    assert.equal(new LocalPreferencesStore(persistent).load().avatarVisible, true);

    const store = new LocalPreferencesStore(persistent);
    store.save({ ...DEFAULT_PREFERENCES, avatarVisible: false });
    assert.equal(store.load().avatarVisible, false);
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
