import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AvatarPortraitArchive, portraitCrop, withPortrait } from "@/lib/avatar/portrait";

// The official Haru sample's head, in anchored model units (see fit-model tests).
const HARU_HEAD = { x: -391, y: -2060, width: 830, height: 746 };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as Storage,
  };
}

const KEY = "kana.avatar.portraits.v1";
const url = (n: number) => `data:image/webp;base64,${n}`;

describe("avatar portrait crop", () => {
  it("takes a square around the head, centred on it, with room above the hair", () => {
    const placement = { x: 720, y: 500, scale: 0.2, resolution: 2 };
    const crop = portraitCrop(HARU_HEAD, placement);
    assert.ok(crop);
    const unit = placement.scale * placement.resolution;
    const headLeft = (placement.x + HARU_HEAD.x * placement.scale) * placement.resolution;
    const headTop = (placement.y + HARU_HEAD.y * placement.scale) * placement.resolution;
    const headWidth = HARU_HEAD.width * unit;

    assert.ok(Math.abs(crop.x + crop.side / 2 - (headLeft + headWidth / 2)) < 1e-6, "centred on the head");
    assert.ok(crop.x < headLeft && crop.x + crop.side > headLeft + headWidth, "the whole head width fits");
    assert.ok(crop.y < headTop, "space above the hair");
    assert.ok(crop.y + crop.side > headTop + HARU_HEAD.height * unit, "the chin and shoulders are inside");
    assert.ok(crop.side < headWidth * 2, "a portrait, not the whole body");
  });

  it("scales with the canvas resolution", () => {
    const one = portraitCrop(HARU_HEAD, { x: 300, y: 400, scale: 0.1, resolution: 1 })!;
    const two = portraitCrop(HARU_HEAD, { x: 300, y: 400, scale: 0.1, resolution: 2 })!;
    for (const key of ["x", "y", "side"] as const) assert.ok(Math.abs(two[key] - one[key] * 2) < 1e-6, key);
  });

  it("gives nothing for a head too small or a broken placement", () => {
    assert.equal(portraitCrop(HARU_HEAD, { x: 0, y: 0, scale: 0.001, resolution: 1 }), null);
    assert.equal(portraitCrop(HARU_HEAD, { x: 0, y: 0, scale: Number.NaN, resolution: 1 }), null);
  });
});

describe("avatar portrait archive", () => {
  it("keeps only image data URLs from storage", () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ a: url(1), b: "https://example.com/x.png", c: 3, d: url(4) }),
    });
    assert.deepEqual(new AvatarPortraitArchive(() => storage).load(), { a: url(1), d: url(4) });
  });

  it("reads broken, missing or blocked storage as no portraits", () => {
    for (const stored of ["not json", "[1,2]", "null"]) {
      const { storage } = memoryStorage({ [KEY]: stored });
      assert.deepEqual(new AvatarPortraitArchive(() => storage).load(), {});
    }
    assert.deepEqual(new AvatarPortraitArchive(() => undefined).load(), {});
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    assert.deepEqual(new AvatarPortraitArchive(() => blocked).load(), {});
  });

  it("keeps the newest sixteen and reads back what it saved", () => {
    const { storage, values } = memoryStorage();
    const archive = new AvatarPortraitArchive(() => storage);
    const all = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`model-${n}`, url(n)]));
    const kept = archive.save(all);
    assert.deepEqual(Object.keys(kept), Array.from({ length: 16 }, (_, n) => `model-${n + 4}`));
    assert.deepEqual(JSON.parse(values.get(KEY)!), kept);
    assert.deepEqual(archive.load(), kept);
  });

  it("still returns the portraits when storage is full", () => {
    const full = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    assert.deepEqual(new AvatarPortraitArchive(() => full).save({ a: url(1) }), { a: url(1) });
  });

  it("moves a retaken portrait to newest and removes a cleared one", () => {
    const portraits = { a: url(1), b: url(2), c: url(3) };
    assert.deepEqual(Object.entries(withPortrait(portraits, "a", url(9))), [["b", url(2)], ["c", url(3)], ["a", url(9)]]);
    assert.deepEqual(withPortrait(portraits, "b", null), { a: url(1), c: url(3) });
    assert.equal(withPortrait(portraits, "missing", null).a, url(1));
  });
});
