import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KanaProtocolError,
  parseKanaResponse,
} from "@/lib/presentation/response-parser";

const envelope = {
  speech_ja: "違いは単純です。",
  subtitle: {
    text: "Bedanya sederhana.",
    language: "id",
  },
  emotion: "neutral",
};

describe("Kana response parsing", () => {
  it("parses the exact protocol envelope", () => {
    assert.deepEqual(parseKanaResponse(JSON.stringify(envelope), "id"), envelope);
  });

  it("extracts a valid envelope after accidental prose", () => {
    const response = parseKanaResponse(
      `Ini seharusnya tidak ikut tampil.\n\n${JSON.stringify(envelope)}`,
      "id",
    );
    assert.equal(response.subtitle.text, "Bedanya sederhana.");
    assert.equal(response.speech_ja, "違いは単純です。");
  });

  it("recovers unescaped quotes inside a mixed subtitle envelope", () => {
    const raw = `Berdasarkan referensi, command yang benar memakai hyphen.\n\n{
      "speech_ja": "正しいのはハイフンです。",
      "subtitle": {
        "text": "Perintah underscore akan menghasilkan "unknown command" atau dianggap skill.",
        "language": "id"
      },
      "emotion": "neutral"
    }`;
    const response = parseKanaResponse(raw, "id");
    assert.equal(
      response.subtitle.text,
      'Perintah underscore akan menghasilkan "unknown command" atau dianggap skill.',
    );
    assert.equal(response.speech_ja, "正しいのはハイフンです。");
  });

  it("never turns malformed JSON-looking output into a visible raw envelope", () => {
    assert.throws(
      () => parseKanaResponse('{"speech_ja": nope}', "id"),
      (error: unknown) =>
        error instanceof KanaProtocolError &&
        /malformed Kana response envelope/.test(error.message),
    );
  });

  it("keeps the plain-text fallback for genuine non-envelope replies", () => {
    const response = parseKanaResponse("Jawaban Hermes biasa.", "id");
    assert.equal(response.subtitle.text, "Jawaban Hermes biasa.");
    assert.equal(response.emotion, "neutral");
  });
});
