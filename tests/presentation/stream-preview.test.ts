import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { streamReplyPreview } from "@/lib/presentation/stream-preview";

describe("focus-mode streaming preview", () => {
  it("holds the opening delimiter and streams only the answer body", () => {
    assert.equal(streamReplyPreview(""), "");
    assert.equal(streamReplyPreview("-"), "");
    assert.equal(streamReplyPreview("---"), "");
    assert.equal(streamReplyPreview("---\n"), "");
    assert.equal(streamReplyPreview("---\nemotion: happy\nlang: id\n"), "");
    assert.equal(
      streamReplyPreview("---\nemotion: happy\nlang: id\n---\nHalo"),
      "Halo",
    );
    assert.equal(
      streamReplyPreview("---\nemotion: happy\nlang: id\n---\nHalo, apa kabar?"),
      "Halo, apa kabar?",
    );
  });

  it("handles a header split across deltas and CRLF line endings", () => {
    assert.equal(streamReplyPreview("---\r\nemotion: neutral\r\n"), "");
    assert.equal(
      streamReplyPreview("---\r\nemotion: neutral\r\nlang: en\r\n---\r\nAnswer"),
      "Answer",
    );
  });

  it("streams a plain reply from its first character", () => {
    assert.equal(streamReplyPreview("Halo"), "Halo");
    assert.equal(streamReplyPreview("Halo, dunia."), "Halo, dunia.");
  });

  it("keeps a protocol 2 JSON envelope out of the preview", () => {
    assert.equal(streamReplyPreview('{"speech_ja": "こんにちは"'), "");
  });
});
