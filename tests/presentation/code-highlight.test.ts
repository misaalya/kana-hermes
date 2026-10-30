import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenizeCode, type CodeToken } from "@/lib/presentation/code-highlight";

const text = (tokens: CodeToken[]) => tokens.map((token) => token.text).join("");
const kinds = (tokens: CodeToken[]) => tokens.filter((token) => token.kind !== "plain");

function has(tokens: CodeToken[], kind: CodeToken["kind"], value: string): boolean {
  return tokens.some((token) => token.kind === kind && token.text === value);
}

describe("code highlighting", () => {
  it("round-trips HTML and marks tags, attributes, and values", () => {
    const source = '<a class="go" href="x">hi</a>';
    const tokens = tokenizeCode(source, "html");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "tag", "<a"));
    assert.ok(has(tokens, "attribute", "class"));
    assert.ok(has(tokens, "string", '"x"'));
    assert.ok(has(tokens, "tag", "</a"));
  });

  it("round-trips JavaScript and marks keywords, numbers, and comments", () => {
    const source = "const answer = 42; // the answer\n`hi ${name}`";
    const tokens = tokenizeCode(source, "javascript");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "keyword", "const"));
    assert.ok(has(tokens, "number", "42"));
    assert.ok(has(tokens, "comment", "// the answer"));
    assert.ok(kinds(tokens).some((token) => token.kind === "string" && token.text.startsWith("`hi")));
  });

  it("treats TypeScript declarations as JavaScript keywords", () => {
    const tokens = tokenizeCode("interface Account { id: string }", "ts");
    assert.ok(has(tokens, "keyword", "interface"));
    assert.ok(has(tokens, "keyword", "string"));
  });

  it("round-trips Python comments, strings, and keywords", () => {
    const source = 'def greet(name):\n    # speak\n    return "hi " + name';
    const tokens = tokenizeCode(source, "python");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "keyword", "def"));
    assert.ok(has(tokens, "keyword", "return"));
    assert.ok(has(tokens, "comment", "# speak"));
    assert.ok(has(tokens, "string", '"hi "'));
  });

  it("round-trips shell variables and keywords", () => {
    const source = 'for f in $HOME; do echo "$f"; done';
    const tokens = tokenizeCode(source, "bash");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "variable", "$HOME"));
    assert.ok(has(tokens, "keyword", "for"));
    assert.ok(has(tokens, "keyword", "done"));
    assert.ok(has(tokens, "string", '"$f"'));
  });

  it("round-trips CSS selectors, properties, colours, and sizes", () => {
    const source = ".card { color: #fff; margin: 10px; }";
    const tokens = tokenizeCode(source, "css");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "tag", ".card"));
    assert.ok(has(tokens, "property", "color"));
    assert.ok(has(tokens, "literal", "#fff"));
    assert.ok(has(tokens, "number", "10px"));
  });

  it("marks SQL keywords whatever their case", () => {
    const source = "SELECT id FROM users WHERE active = true;";
    const tokens = tokenizeCode(source, "sql");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "keyword", "SELECT"));
    assert.ok(has(tokens, "keyword", "FROM"));
    assert.ok(has(tokens, "keyword", "WHERE"));
    assert.ok(has(tokens, "literal", "true"));
  });

  it("round-trips YAML keys and values", () => {
    const source = "name: Kana\nport: 3000\nenabled: true";
    const tokens = tokenizeCode(source, "yaml");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "property", "name"));
    assert.ok(has(tokens, "property", "port"));
    assert.ok(has(tokens, "number", "3000"));
    assert.ok(has(tokens, "literal", "true"));
  });

  it("marks JSON keys and values through the JSON reader", () => {
    const source = '{"name": "Kana", "ready": true}';
    const tokens = tokenizeCode(source, "json");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "property", '"name"'));
    assert.ok(has(tokens, "string", '"Kana"'));
    assert.ok(has(tokens, "literal", "true"));
  });

  it("keeps text blocks and unknown empty languages plain", () => {
    const source = "total 12\nREADME.md  drwxr-xr-x";
    assert.deepEqual(tokenizeCode(source, ""), [{ kind: "plain", text: source }]);
    assert.deepEqual(tokenizeCode(source, "text"), [{ kind: "plain", text: source }]);
  });

  it("still round-trips an unknown language through the generic profile", () => {
    const source = "fun main() {\n  println(\"hi\")\n}";
    const tokens = tokenizeCode(source, "kotlin");
    assert.equal(text(tokens), source);
    assert.ok(has(tokens, "keyword", "fun"));
    assert.ok(has(tokens, "string", '"hi"'));
  });
});
