import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAvatarModelFiles } from "@/lib/avatar/indexed-db-avatar-model-store";
import {
  prepareLive2DPackageFiles,
  prioritizeLive2DSettingsFile,
} from "@/lib/avatar/pixi-live2d-runtime-adapter";
import {
  discoverLive2DModelCapabilities,
  suggestLive2DModelBindings,
} from "@/lib/avatar/live2d-model-capabilities";

function modelFile(path: string, content: BlobPart = "asset"): File {
  const file = new File([content], path.split("/").at(-1) || "asset", {
    type: path.endsWith(".json") ? "application/json" : "application/octet-stream",
  });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: path,
  });
  return file;
}

function settings(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: "Kana.moc3",
      Textures: ["textures/texture_00.png"],
      Physics: "Kana.physics3.json",
      Expressions: [{ Name: "Happy", File: "expressions/happy.exp3.json" }],
      Motions: {
        Idle: [{ File: "motions/idle.motion3.json" }],
      },
      ...overrides,
    },
  });
}

describe("Live2D package validation", () => {
  it("accepts a complete package and reports its local size", async () => {
    const files = [
      modelFile("Kana/Kana.model3.json", settings()),
      modelFile("Kana/Kana.moc3"),
      modelFile("Kana/textures/texture_00.png"),
      modelFile("Kana/Kana.physics3.json", "{}"),
      modelFile("Kana/expressions/happy.exp3.json", "{}"),
      modelFile("Kana/motions/idle.motion3.json", "{}"),
    ];
    const result = await validateAvatarModelFiles(files);
    assert.equal(result.modelSettingsPath, "Kana/Kana.model3.json");
    assert.equal(result.paths.length, files.length);
    assert.equal(
      result.sizeBytes,
      files.reduce((total, file) => total + file.size, 0),
    );
  });

  it("lists every missing asset before IndexedDB is changed", async () => {
    const files = [modelFile("Kana/Kana.model3.json", settings())];
    await assert.rejects(
      validateAvatarModelFiles(files),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Kana\/Kana\.moc3/);
        assert.match(error.message, /Kana\/textures\/texture_00\.png/);
        assert.match(error.message, /Kana\/motions\/idle\.motion3\.json/);
        return true;
      },
    );
  });

  it("rejects references that escape the selected folder", async () => {
    const files = [
      modelFile(
        "Kana/Kana.model3.json",
        settings({ Moc: "../../outside.moc3" }),
      ),
      modelFile("Kana/textures/texture_00.png"),
    ];
    await assert.rejects(
      validateAvatarModelFiles(files),
      /escapes the imported folder/i,
    );
  });

  it("prioritizes model3 settings over companion filenames ending in model.json", () => {
    const companion = modelFile(
      "Kana/items_pinned_to_model.json",
      JSON.stringify({ items: [] }),
    );
    const settingsFile = modelFile("Kana/Kana.model3.json", settings());
    const texture = modelFile("Kana/textures/texture_00.png");
    const original = [companion, settingsFile, texture];

    const ordered = prioritizeLive2DSettingsFile(original);

    assert.equal(ordered[0], settingsFile);
    assert.deepEqual(ordered.slice(1), [companion, texture]);
    assert.deepEqual(original, [companion, settingsFile, texture]);
  });

  it("roots imported paths for pixi-live2d-display URL resolution", () => {
    const files = [
      modelFile("Kana/Kana.moc3"),
      modelFile("Kana/Kana.model3.json", settings()),
      modelFile("Kana/textures/texture_00.png"),
    ];

    const prepared = prepareLive2DPackageFiles(files);

    assert.equal(prepared[0].name, "Kana.model3.json");
    assert.deepEqual(
      prepared.map((file) => file.webkitRelativePath),
      [
        "/Kana/Kana.model3.json",
        "/Kana/Kana.moc3",
        "/Kana/textures/texture_00.png",
      ],
    );
    assert.notEqual(prepared[0], files[1]);
  });

  it("discovers registered capabilities without treating loose presets as emotions", async () => {
    const files = [
      modelFile(
        "Kana/Kana.model3.json",
        settings({
          DisplayInfo: "Kana.cdi3.json",
          Expressions: [{ Name: "Big Smile", File: "expressions/happy.exp3.json" }],
          Motions: { Think: [{ File: "motions/thinking.motion3.json" }] },
        }),
      ),
      modelFile("Kana/Kana.cdi3.json", JSON.stringify({
        Parameters: [
          { Id: "ParamMouthOpenY", Name: "Mouth open" },
          { Id: "ParamEyeLSmile", Name: "Left eye smile" },
        ],
      })),
      modelFile("Kana/expressions/happy.exp3.json", "{}"),
      modelFile("Kana/expressions/accessory.exp3.json", "{}"),
      modelFile("Kana/motions/thinking.motion3.json", "{}"),
      modelFile("Kana/motions/accessory.motion3.json", "{}"),
    ];

    const capabilities = await discoverLive2DModelCapabilities(files);
    const suggested = suggestLive2DModelBindings(capabilities);

    assert.deepEqual(capabilities.expressions, [{
      name: "Big Smile",
      file: "Kana/expressions/happy.exp3.json",
    }]);
    assert.deepEqual(capabilities.motions, [{
      group: "Think",
      index: 0,
      file: "Kana/motions/thinking.motion3.json",
    }]);
    assert.equal(capabilities.suggestedMouthParameter, "ParamMouthOpenY");
    assert.deepEqual(capabilities.unregisteredExpressionFiles, [
      "Kana/expressions/accessory.exp3.json",
    ]);
    assert.deepEqual(capabilities.unregisteredMotionFiles, [
      "Kana/motions/accessory.motion3.json",
    ]);
    assert.equal(suggested.emotionExpressions?.happy, "Big Smile");
    assert.deepEqual(suggested.emotionMotions?.thinking, {
      group: "Think",
      index: 0,
    });
    assert.equal(suggested.emotionExpressions?.excited, undefined);
  });
});
