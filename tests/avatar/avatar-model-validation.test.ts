import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAvatarModelFiles } from "@/lib/avatar/indexed-db-avatar-model-store";
import {
  prepareLive2DPackageFiles,
  prioritizeLive2DSettingsFile,
  selectLive2DMouthParameterId,
} from "@/lib/avatar/pixi-live2d-runtime-adapter";
import {
  discoverLive2DModelCapabilities,
  RECOVERED_MOTION_GROUP,
  suggestLive2DModelBindings,
  withRecoveredLive2DPresets,
} from "@/lib/avatar/live2d-model-capabilities";
import {
  createLipSyncPlugin,
  createMotionUpdateHook,
  type MotionManagerLike,
} from "@/lib/avatar/live2d/motion-update";

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

  it("recovers loose presets without inventing their semantic emotion", async () => {
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

    assert.deepEqual(capabilities.expressions, [
      {
        name: "Big Smile",
        file: "Kana/expressions/happy.exp3.json",
      },
      {
        name: "accessory",
        file: "Kana/expressions/accessory.exp3.json",
      },
    ]);
    assert.deepEqual(capabilities.motions, [
      {
        group: "Think",
        index: 0,
        file: "Kana/motions/thinking.motion3.json",
      },
      {
        group: RECOVERED_MOTION_GROUP,
        index: 0,
        file: "Kana/motions/accessory.motion3.json",
        name: "accessory",
      },
    ]);
    assert.equal(capabilities.suggestedMouthParameter, "ParamMouthOpenY");
    assert.equal(suggested.mouthOpenParameter, "auto");
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

  it("registers loose presets in a runtime-only model3 copy", async () => {
    const files = [
      modelFile("Kana/Kana.model3.json", settings({ Expressions: undefined, Motions: undefined })),
      modelFile("Kana/Kana.moc3"),
      modelFile("Kana/textures/texture_00.png"),
      modelFile("Kana/Kana.physics3.json", "{}"),
      modelFile("Kana/expressions/toggle-1.exp3.json", "{}"),
      modelFile("Kana/motions/wave.motion3.json", "{}"),
    ];

    const recovered = await withRecoveredLive2DPresets(files);
    const recoveredSettings = JSON.parse(await recovered[0].text()) as {
      FileReferences: {
        Expressions: Array<{ Name: string; File: string }>;
        Motions: Record<string, Array<{ File: string }>>;
      };
    };

    assert.notEqual(recovered[0], files[0]);
    assert.deepEqual(recoveredSettings.FileReferences.Expressions, [{
      Name: "toggle 1",
      File: "expressions/toggle-1.exp3.json",
    }]);
    assert.deepEqual(recoveredSettings.FileReferences.Motions[RECOVERED_MOTION_GROUP], [{
      File: "motions/wave.motion3.json",
    }]);
    assert.equal(await files[0].text(), settings({ Expressions: undefined, Motions: undefined }));
  });

  it("reads the VTube Studio MouthOpen mapping when model3 lip-sync metadata is empty", async () => {
    const files = [
      modelFile("Kana/Kana.model3.json", JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: "Kana.moc3",
          Textures: ["textures/texture_00.png"],
          DisplayInfo: "Kana.cdi3.json",
        },
        Groups: [{ Target: "Parameter", Name: "LipSync", Ids: [] }],
      })),
      modelFile("Kana/Kana.moc3"),
      modelFile("Kana/textures/texture_00.png"),
      modelFile("Kana/Kana.cdi3.json", JSON.stringify({
        Parameters: [
          { Id: "ParamMouthForm", Name: "Mouth form" },
          { Id: "CustomMouthY", Name: "Mouth opening" },
        ],
      })),
      modelFile("Kana/Kana.vtube.json", JSON.stringify({
        ParameterSettings: [
          { Input: "MouthSmile", OutputLive2D: "ParamMouthForm" },
          { Input: "MouthOpen", OutputLive2D: "CustomMouthY", Name: "Mouth Open" },
        ],
      })),
    ];

    const capabilities = await discoverLive2DModelCapabilities(files);

    assert.equal(capabilities.suggestedMouthParameter, "CustomMouthY");
    assert.ok(capabilities.parameters.some(({ id }) => id === "CustomMouthY"));
  });
});

describe("Live2D automatic lip-sync selection", () => {
  it("prefers model metadata in automatic mode", () => {
    assert.equal(selectLive2DMouthParameterId({
      configured: "auto",
      loaded: ["ParamMouthOpenY", "CustomVoice"],
      registered: ["CustomVoice"],
    }), "CustomVoice");
  });

  it("uses the standard mouth parameter when metadata is missing", () => {
    assert.equal(selectLive2DMouthParameterId({
      configured: "auto",
      loaded: ["ParamBodyAngleX", "ParamMouthOpenY"],
      registered: [],
    }), "ParamMouthOpenY");
  });

  it("does not mistake mouth form for mouth opening when both are registered", () => {
    assert.equal(selectLive2DMouthParameterId({
      configured: "auto",
      loaded: ["ParamMouthForm", "ParamMouthOpenY"],
      registered: ["ParamMouthForm", "ParamMouthOpenY"],
    }), "ParamMouthOpenY");
  });

  it("honors a manual override and falls back when it no longer exists", () => {
    assert.equal(selectLive2DMouthParameterId({
      configured: "ParamBodyAngleX",
      loaded: ["ParamBodyAngleX", "ParamMouthOpenY"],
      registered: [],
    }), "ParamBodyAngleX");
    assert.equal(selectLive2DMouthParameterId({
      configured: "MissingParameter",
      loaded: ["ParamMouthOpenY"],
      registered: [],
    }), "ParamMouthOpenY");
  });
});

describe("Live2D motion-loop lip-sync", () => {
  it("writes the speech amplitude after motion curves", () => {
    let speaking = true;
    let mouthOpen = 0.72;
    let renderedValue = 0;
    const coreModel = {
      setParameterValueById: (_id: string, value: number) => {
        renderedValue = value;
      },
      getParameterValueById: () => renderedValue,
    };
    const motionManager: MotionManagerLike = {
      update: () => {
        renderedValue = 0.05;
        return true;
      },
    };
    const hook = createMotionUpdateHook(motionManager);
    hook.register(createLipSyncPlugin({
      mouthOpenParameterId: "ParamMouthOpenY",
      getMouthOpen: () => mouthOpen,
      isSpeaking: () => speaking,
    }), "final");

    motionManager.update(coreModel, 1);
    assert.equal(renderedValue, 0.72);

    mouthOpen = 2;
    motionManager.update(coreModel, 1.016);
    assert.equal(renderedValue, 1);

    speaking = false;
    motionManager.update(coreModel, 1.232);
    assert.ok(renderedValue < 1);
  });
});
