import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateStageBackgroundFile } from "@/lib/background/indexed-db-stage-background-store";

describe("local stage background validation", () => {
  it("accepts common browser image formats", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/bmp",
    ]) {
      assert.doesNotThrow(() =>
        validateStageBackgroundFile(new File(["image"], "background", { type })),
      );
    }
  });

  it("rejects active or non-image uploads and oversized files", () => {
    assert.throws(
      () => validateStageBackgroundFile(
        new File(["<svg/>"] , "unsafe.svg", { type: "image/svg+xml" }),
      ),
      /PNG, JPEG, WebP, GIF, AVIF, or BMP/,
    );
    assert.throws(
      () => validateStageBackgroundFile(
        new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ),
      /smaller than 25 MB/,
    );
  });
});
