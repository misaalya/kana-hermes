import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSupportedMoc3,
  FALLBACK_LATEST_MOC3_VERSION,
  latestSupportedMoc3Version,
  readMoc3Version,
  UnsupportedMoc3VersionError,
} from "@/lib/avatar/live2d/moc3-version";
import { AvatarLoadSupersededError, ManagedAvatarProvider } from "@/lib/avatar/managed-avatar-provider";
import type { AvatarProvider } from "@/lib/avatar/types";

const header = (version: number) => new Uint8Array([0x4d, 0x4f, 0x43, 0x33, version, 0, 0, 0]);

describe("moc3 version checks", () => {
  it("reads the format version from real sample headers", () => {
    // Haru (1), Hiyori (3), Mao (5), and Ren (6) from the official samples.
    for (const version of [1, 3, 5, 6]) {
      assert.equal(readMoc3Version(header(version)), version);
    }
    assert.equal(readMoc3Version(header(6).buffer), 6);
  });

  it("returns null for data that is not a moc3 header", () => {
    assert.equal(readMoc3Version(new TextEncoder().encode("asset")), null);
    assert.equal(readMoc3Version(new Uint8Array([0x4d, 0x4f])), null);
    assert.equal(readMoc3Version(header(0)), null);
  });

  it("uses the loaded Cubism Core's latest version, with a verified fallback", () => {
    const core = { Version: { csmGetLatestMocVersion: () => 6 } };
    assert.equal(latestSupportedMoc3Version(core), 6);
    assert.equal(latestSupportedMoc3Version(undefined), FALLBACK_LATEST_MOC3_VERSION);
    assert.equal(
      latestSupportedMoc3Version({ Version: { csmGetLatestMocVersion: () => { throw new Error("x"); } } }),
      FALLBACK_LATEST_MOC3_VERSION,
    );
  });

  it("accepts supported versions and names the unsupported one", () => {
    assert.doesNotThrow(() => assertSupportedMoc3(header(5), 5));
    assert.throws(
      () => assertSupportedMoc3(header(6), 5),
      (error: unknown) =>
        error instanceof UnsupportedMoc3VersionError
        && error.version === 6
        && /up to version 5/.test(error.message),
    );
    assert.throws(() => assertSupportedMoc3(new TextEncoder().encode("html"), 5), /not a valid moc3/);
  });
});

describe("avatar load failure state", () => {
  const failing: AvatarProvider = {
    id: "live2d",
    load: () => Promise.reject(new UnsupportedMoc3VersionError(6, 5)),
    unload: () => undefined,
    setEmotion: () => undefined,
    playMotion: () => undefined,
    setMouthOpen: () => undefined,
    setTalking: () => undefined,
  };

  it("exposes the failure reason instead of looking like it is still loading", async () => {
    const managed = new ManagedAvatarProvider();
    await assert.rejects(managed.use(failing, { id: "ren", name: "Ren" }), UnsupportedMoc3VersionError);
    const snapshot = managed.getSnapshot();
    assert.equal(snapshot.renderMode, "mock");
    assert.match(snapshot.loadError ?? "", /moc3 format version 6/);
  });

  it("clears the failure once a model loads", async () => {
    const managed = new ManagedAvatarProvider();
    await managed.use(failing, { id: "ren", name: "Ren" }).catch(() => undefined);
    await managed.use({ ...failing, load: () => Promise.resolve() }, { id: "haru", name: "Haru" });
    const snapshot = managed.getSnapshot();
    assert.equal(snapshot.renderMode, "live2d");
    assert.equal(snapshot.loadError, undefined);
  });

  function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  }

  it("does not keep showing the previous failure while the next model loads", async () => {
    const managed = new ManagedAvatarProvider();
    await managed.use(failing, { id: "ren", name: "Ren" }).catch(() => undefined);
    const haru = deferred();
    const loading = managed.use({ ...failing, load: () => haru.promise }, { id: "haru", name: "Haru" });
    assert.equal(managed.getSnapshot().loadError, undefined);
    haru.resolve();
    await loading;
  });

  it("ignores an older load that fails after a newer model loaded", async () => {
    const managed = new ManagedAvatarProvider();
    const ren = deferred();
    let renUnloaded = 0;
    const renLoad = managed.use(
      { ...failing, load: () => ren.promise, unload: () => { renUnloaded += 1; } },
      { id: "ren", name: "Ren" },
    );
    const talking: boolean[] = [];
    await managed.use(
      { ...failing, load: () => Promise.resolve(), setTalking: (value) => { talking.push(value); } },
      { id: "haru", name: "Haru" },
    );

    ren.reject(new UnsupportedMoc3VersionError(6, 5));
    await assert.rejects(renLoad, AvatarLoadSupersededError);

    const snapshot = managed.getSnapshot();
    assert.equal(snapshot.renderMode, "live2d");
    assert.equal(snapshot.loadError, undefined);
    assert.ok(renUnloaded > 0);
    // Haru is still the active renderer.
    managed.setTalking(true);
    assert.deepEqual(talking, [true]);
  });

  it("discards an older load that succeeds after a newer one started", async () => {
    const managed = new ManagedAvatarProvider();
    const slow = deferred();
    const older = managed.use({ ...failing, load: () => slow.promise }, { id: "old", name: "Old" });
    const fresh = deferred();
    const talking: string[] = [];
    const newer = managed.use(
      { ...failing, load: () => fresh.promise, setTalking: () => { talking.push("new"); } },
      { id: "new", name: "New" },
    );

    slow.resolve();
    await assert.rejects(older, AvatarLoadSupersededError);
    fresh.resolve();
    await newer;
    assert.equal(managed.getSnapshot().renderMode, "live2d");
    managed.setTalking(true);
    assert.deepEqual(talking, ["new"]);
  });
});
