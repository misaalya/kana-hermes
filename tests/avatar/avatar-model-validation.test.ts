import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAvatarModelFiles } from "@/lib/avatar/indexed-db-avatar-model-store";

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
});
