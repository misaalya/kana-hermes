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
    assert.deepEqual(parseKanaResponse(JSON.stringify(envelope)), envelope);
  });

  it("extracts a valid envelope after accidental prose", () => {
    const response = parseKanaResponse(
      `Ini seharusnya tidak ikut tampil.\n\n${JSON.stringify(envelope)}`,
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
    const response = parseKanaResponse(raw);
    assert.equal(
      response.subtitle.text,
      'Perintah underscore akan menghasilkan "unknown command" atau dianggap skill.',
    );
    assert.equal(response.speech_ja, "正しいのはハイフンです。");
  });

  it("never turns malformed JSON-looking output into a visible raw envelope", () => {
    assert.throws(
      () => parseKanaResponse('{"speech_ja": nope}'),
      (error: unknown) =>
        error instanceof KanaProtocolError &&
        /malformed Kana response envelope/.test(error.message),
    );
  });

  it("keeps the plain-text fallback for genuine non-envelope replies, without a voice", () => {
    const response = parseKanaResponse("Jawaban Hermes biasa.");
    assert.equal(response.subtitle.text, "Jawaban Hermes biasa.");
    assert.equal(response.subtitle.language, "und");
    assert.equal(response.speech_ja, "", "the Japanese voice never reads another language");
    assert.equal(response.emotion, "neutral");
  });

  it("speaks a plain reply only when it is mostly Japanese", () => {
    assert.equal(parseKanaResponse("はい、わかりました。git を使います。").speech_ja, "はい、わかりました。git を使います。");
    assert.equal(parseKanaResponse("Haii~ Kana-chan di sini! ✨ 日本").speech_ja, "");
  });

  it("shows a Markdown answer that opens with a code block instead of failing", () => {
    const raw = "```bash\ngit rebase main\n```\nThat moves your commits.";
    const response = parseKanaResponse(raw);
    assert.equal(response.subtitle.text, raw);
    assert.equal(response.speech_ja, "");
  });

  it("drops non-Japanese speech from a JSON envelope but keeps its subtitle", () => {
    const response = parseKanaResponse(JSON.stringify({ ...envelope, speech_ja: "Bedanya sederhana." }));
    assert.equal(response.speech_ja, "");
    assert.equal(response.subtitle.text, "Bedanya sederhana.");
  });
});

describe("Kana response parsing, protocol 3 header", () => {
  it("reads the header and keeps the Markdown answer intact", () => {
    // A real GPT 5.6 Luna reply, including a horizontal rule in the answer.
    const raw = [
      "---",
      "ja: ギットマージは履歴を統合し、リベースは一直線の履歴を作ります。",
      "emotion: neutral",
      "lang: en",
      "---",
      "`git merge` combines two branches.",
      "",
      "```bash",
      "git merge main",
      "```",
      "",
      "---",
      "",
      "Use rebase cautiously.",
    ].join("\n");
    assert.deepEqual(parseKanaResponse(raw), {
      speech_ja: "ギットマージは履歴を統合し、リベースは一直線の履歴を作ります。",
      subtitle: {
        text: "`git merge` combines two branches.\n\n```bash\ngit merge main\n```\n\n---\n\nUse rebase cautiously.",
        language: "en",
      },
      emotion: "neutral",
    });
  });

  it("tolerates a fenced reply, quoted values, a wrapped ja line and unknown values", () => {
    const raw = [
      "```markdown",
      "---",
      'ja: "こんにちは。',
      '今日も元気です。"',
      "emotion: <Happy>",
      "lang: Indonesian",
      "mood: cheerful",
      "---",
      "Halo! Contoh:",
      "```js",
      "hello()",
      "```",
      "```",
    ].join("\n");
    const response = parseKanaResponse(raw);
    assert.equal(response.speech_ja, "こんにちは。 今日も元気です。");
    assert.equal(response.emotion, "happy");
    assert.equal(response.subtitle.language, "und", "a language name is not a BCP 47 code");
    assert.equal(response.subtitle.text, "Halo! Contoh:\n```js\nhello()\n```");
    assert.equal(parseKanaResponse("---\nja: はい。\nemotion: sleepy\nlang: id\n---\nYa.").emotion, "neutral");
  });

  it("accepts a header without its opening rule and keeps prose written before it", () => {
    const bare = parseKanaResponse("ja: はい。\nemotion: happy\nlang: id\n---\nYa!");
    assert.equal(bare.speech_ja, "はい。");
    assert.equal(bare.subtitle.text, "Ya!");
    const prose = parseKanaResponse("Oke.\n\n---\nja: はい。\nlang: id\n---\nYa!");
    assert.equal(prose.subtitle.text, "Oke.\n\nYa!");
  });

  it("never speaks a ja line that is not Japanese, and shows ja alone when there is no answer", () => {
    const wrongLanguage = parseKanaResponse("---\nja: Halo, aku baik.\nlang: id\n---\nHalo, aku baik.");
    assert.equal(wrongLanguage.speech_ja, "");
    assert.equal(wrongLanguage.subtitle.text, "Halo, aku baik.");
    assert.deepEqual(parseKanaResponse("---\nja: はい。\nemotion: happy\nlang: id\n---\n").subtitle, {
      text: "はい。",
      language: "ja",
    });
    assert.throws(() => parseKanaResponse("---\nja: \nlang: id\n---\n"), KanaProtocolError);
  });

  it("reads a header without ja, written while Kana's voice is off, as a silent reply", () => {
    const silent = parseKanaResponse("---\nemotion: happy\nlang: id\n---\n**Siap!** Sudah beres.");
    assert.deepEqual(silent, {
      speech_ja: "",
      subtitle: { text: "**Siap!** Sudah beres.", language: "id" },
      emotion: "happy",
    });
    const bare = parseKanaResponse("emotion: thinking\nlang: en\n---\nLet me check.");
    assert.equal(bare.subtitle.text, "Let me check.");
    assert.equal(bare.emotion, "thinking");
    const fenced = parseKanaResponse("```\nemotion: neutral\nlang: en\n---\nDone.\n```");
    assert.equal(fenced.subtitle.text, "Done.");
    assert.throws(() => parseKanaResponse("---\nemotion: happy\nlang: id\n---\n"), KanaProtocolError);
  });

  it("leaves an answer that opens with the word emotion alone", () => {
    const raw = "Emotion: it depends on the context.\nMost people feel both.";
    assert.equal(parseKanaResponse(raw).subtitle.text, raw);
  });

  it("leaves an ordinary answer that merely mentions speech alone", () => {
    const raw = "Two terms:\nspeech: spoken words\nlanguage: the system of words";
    const response = parseKanaResponse(raw);
    assert.equal(response.subtitle.text, raw);
    assert.equal(parseKanaResponse("---\nlanguage: Python\n---\nCode.").subtitle.text, "---\nlanguage: Python\n---\nCode.");
  });
});
