import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvatarController } from "@/lib/avatar/avatar-controller";
import type { ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import type { AvatarPortraits } from "@/lib/avatar/portrait";
import { DEFAULT_PREFERENCES } from "@/lib/preferences/local-preferences-store";
import { AvatarService, type AvatarModelLibrary } from "@/lib/services/avatar-service";
import { PreferencesAccess } from "@/lib/services/preferences-service";
import { createAvatarStore, EMPTY_AVATAR } from "@/lib/store/avatar-store";
import { createErrorStore } from "@/lib/store/error-store";
import { createPreferencesStore } from "@/lib/store/preferences-store";

const url = (n: number) => `data:image/webp;base64,${n}`;

function service(stored: AvatarPortraits) {
  const saved: AvatarPortraits[] = [];
  const deleted: string[] = [];
  const avatar = createAvatarStore();
  const preferences = new PreferencesAccess(createPreferencesStore(), {
    load: () => DEFAULT_PREFERENCES,
    save: () => undefined,
    consumeWarning: () => null,
  });
  preferences.adopt(DEFAULT_PREFERENCES);
  const provider = { getSnapshot: () => EMPTY_AVATAR, subscribe: () => () => undefined } as unknown as ManagedAvatarProvider;
  const models = { delete: async (id: string) => void deleted.push(id) } as unknown as AvatarModelLibrary;
  const avatarService = new AvatarService({
    avatar,
    errors: createErrorStore(),
    preferences,
    provider,
    controller: {} as AvatarController,
    models,
    portraits: {
      load: () => stored,
      save: (portraits) => {
        saved.push(portraits);
        return portraits;
      },
    },
  });
  return { avatar, avatarService, saved, deleted };
}

describe("avatar service portraits", () => {
  it("shows the portraits this browser kept once it starts", () => {
    const { avatar, avatarService } = service({ "avatar-1": url(1) });
    assert.deepEqual(avatar.getState().portraits, {});
    avatarService.start();
    assert.deepEqual(avatar.getState().portraits, { "avatar-1": url(1) });
  });

  it("forgets a deleted model's portrait and leaves the others", async () => {
    const { avatar, avatarService, saved, deleted } = service({ "avatar-1": url(1), "avatar-2": url(2) });
    avatarService.start();
    await avatarService.deleteModel("avatar-1");
    assert.deepEqual(deleted, ["avatar-1"]);
    assert.deepEqual(avatar.getState().portraits, { "avatar-2": url(2) });
    assert.deepEqual(saved, [{ "avatar-2": url(2) }]);

    // A model that never had a portrait writes nothing.
    await avatarService.deleteModel("avatar-3");
    assert.equal(saved.length, 1);
  });
});

function canvas(name: string) {
  return { name } as unknown as HTMLCanvasElement;
}

function canvasService() {
  const loaded: Array<HTMLCanvasElement | undefined> = [];
  const preferences = new PreferencesAccess(createPreferencesStore(), {
    load: () => DEFAULT_PREFERENCES,
    save: () => undefined,
    consumeWarning: () => null,
  });
  preferences.adopt(DEFAULT_PREFERENCES);
  const provider = {
    use: async (_provider: unknown, source: { canvas?: HTMLCanvasElement }) => {
      loaded.push(source.canvas);
    },
    unload: () => undefined,
    getSnapshot: () => EMPTY_AVATAR,
    subscribe: () => () => undefined,
  } as unknown as ManagedAvatarProvider;
  const avatarService = new AvatarService({
    avatar: createAvatarStore(),
    errors: createErrorStore(),
    preferences,
    provider,
    controller: {
      presentEmotion: () => undefined,
      setLayout: () => undefined,
    } as unknown as AvatarController,
    models: { load: async () => null } as unknown as AvatarModelLibrary,
    portraits: { load: () => ({}), save: (portraits) => portraits },
  });
  return { avatarService, loaded };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("avatar service canvas", () => {
  it("loads the model again when the stage hands over a new canvas", async () => {
    const { avatarService, loaded } = canvasService();
    const first = canvas("first");
    avatarService.attachCanvas(first);
    await settle();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0], first);

    // A connection gate unmounts the stage; the reconnect mounts a new canvas,
    // so the model must be loaded onto it instead of the detached one.
    avatarService.attachCanvas(null);
    const second = canvas("second");
    avatarService.attachCanvas(second);
    await settle();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[1], second);

    // Reattaching the same canvas must not reload the model.
    avatarService.attachCanvas(second);
    await settle();
    assert.equal(loaded.length, 2);
    avatarService.dispose();
  });
});
