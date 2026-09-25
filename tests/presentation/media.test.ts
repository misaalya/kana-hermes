import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMediaAttachments, mediaKind, mediaPreviewText } from "@/lib/presentation/media";

const link = (name: string) => `/api/media/abc_DEF-123/${encodeURIComponent(name)}`;

describe("delivered files in a reply", () => {
  it("pulls signed links out of the text as attachments, in order and once each", () => {
    const text = [
      "Hehe, tentu dong~ Suaranya lebih imut.",
      "",
      `MEDIA:${link("tts_1.mp3")} [[audio_as_voice]]`,
      "",
      `Dan gambarnya: **MEDIA:${link("foto kucing.png")}**`,
      `MEDIA:${link("tts_1.mp3")}.`,
    ].join("\n");
    const { text: rest, attachments } = extractMediaAttachments(text);
    assert.equal(rest, "Hehe, tentu dong~ Suaranya lebih imut.\n\nDan gambarnya:");
    assert.deepEqual(attachments, [
      { url: link("tts_1.mp3"), name: "tts_1.mp3", kind: "audio" },
      { url: link("foto kucing.png"), name: "foto kucing.png", kind: "image" },
    ]);
  });

  it("leaves a local path that the server did not sign as plain text", () => {
    const text = "MEDIA:/home/me/missing.mp3";
    assert.deepEqual(extractMediaAttachments(text), { text, attachments: [] });
  });

  it("knows what the browser can play or show, and downloads the rest", () => {
    assert.deepEqual(
      ["a.MP3", "b.opus", "c.mp4", "d.webm", "e.jpeg", "f.svg", "g.pdf", "Makefile"].map(mediaKind),
      ["audio", "audio", "video", "video", "image", "file", "file", "file"],
    );
  });

  it("previews a file-only reply by its name", () => {
    assert.equal(mediaPreviewText(`MEDIA:${link("tts_1.mp3")}`), "tts_1.mp3");
    assert.equal(mediaPreviewText(`Done!\nMEDIA:${link("tts_1.mp3")}`), "Done!");
    assert.equal(mediaPreviewText(undefined), undefined);
  });
});
