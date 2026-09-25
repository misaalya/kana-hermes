import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenizeJson, type JsonToken } from "@/lib/presentation/json-highlight";

const kinds = (tokens: JsonToken[]) =>
  tokens.filter((token) => token.kind !== "plain").map((token) => [token.kind, token.text]);

describe("JSON highlighting", () => {
  it("tells keys from string values and colours numbers and literals", () => {
    const source = '{\n  "tts": {\n    "timeoutSeconds": 1800,\n    "debug": false,\n    "voice": "rachel"\n  }\n}';
    const tokens = tokenizeJson(source);
    assert.equal(tokens.map((token) => token.text).join(""), source);
    assert.deepEqual(kinds(tokens), [
      ["punctuation", "{"],
      ["key", '"tts"'],
      ["punctuation", ":"],
      ["punctuation", "{"],
      ["key", '"timeoutSeconds"'],
      ["punctuation", ":"],
      ["number", "1800"],
      ["punctuation", ","],
      ["key", '"debug"'],
      ["punctuation", ":"],
      ["literal", "false"],
      ["punctuation", ","],
      ["key", '"voice"'],
      ["punctuation", ":"],
      ["string", '"rachel"'],
      ["punctuation", "}"],
      ["punctuation", "}"],
    ]);
  });

  it("keeps digits, colons and escaped quotes inside strings as one string", () => {
    const tokens = tokenizeJson('{"path": "C:\\\\kana \\"v2\\" 9119", "port": -1.5e3}');
    assert.deepEqual(kinds(tokens).filter(([kind]) => kind !== "punctuation"), [
      ["key", '"path"'],
      ["string", '"C:\\\\kana \\"v2\\" 9119"'],
      ["key", '"port"'],
      ["number", "-1.5e3"],
    ]);
  });

  it("never drops text it does not understand", () => {
    const source = '{ "broken": tru, // note\n "open": "unterminated\n}';
    assert.equal(tokenizeJson(source).map((token) => token.text).join(""), source);
  });
});
