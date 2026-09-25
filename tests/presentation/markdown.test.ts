import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInline, parseMarkdown, safeHref } from "@/lib/presentation/markdown";

describe("chat Markdown", () => {
  it("reads the emphasis, lists, and citations Hermes writes", () => {
    const blocks = parseMarkdown(
      "Berikut berita terkait **Presiden Prabowo** untuk **25 September**:\n\n" +
        "- **Fokus gambut:** Prabowo meminta masukan.[1]\n" +
        "- **Pendidikan gratis:** dari SD hingga universitas.[2]\n\n" +
        "Sumber: [BBC](https://www.bbc.com/indonesia/articles/cr86xn92eey8o)",
    );
    assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "list", "paragraph"]);
    const [intro, list, source] = blocks;
    assert.ok(intro.type === "paragraph");
    assert.deepEqual(intro.children.filter((node) => node.type === "strong").length, 2);
    assert.ok(list.type === "list" && !list.ordered && list.items.length === 2);
    const first = list.items[0][0];
    assert.ok(first.type === "paragraph" && first.children[0].type === "strong");
    const tail = first.children.at(-1);
    assert.ok(tail?.type === "text" && tail.text.endsWith("masukan.[1]"), "citations stay literal");
    assert.ok(source.type === "paragraph");
    const link = source.children.find((node) => node.type === "link");
    assert.ok(link && link.type === "link");
    assert.equal(link.href, "https://www.bbc.com/indonesia/articles/cr86xn92eey8o");
  });

  it("keeps a list going across blank lines and nests indented items", () => {
    const [list] = parseMarkdown("1. one\n\n2. two\n   - child\n3. three");
    assert.ok(list.type === "list" && list.ordered);
    assert.equal(list.items.length, 3);
    assert.deepEqual(list.items[1].map((block) => block.type), ["paragraph", "list"]);
    const [, from] = parseMarkdown("intro\n\n4. four\n5. five");
    assert.ok(from.type === "list" && from.start === 4);
  });

  it("reads headings, quotes, rules, code blocks, and tables", () => {
    const blocks = parseMarkdown(
      "## Ringkasan\n> dikutip\n\n---\n```ts\nconst a = 1 * 2 * 3;\n```\n| Kota | Suhu |\n| :--- | ---: |\n| Kupang | 31 |",
    );
    assert.deepEqual(blocks.map((block) => block.type), ["heading", "quote", "rule", "code", "table"]);
    const code = blocks[3];
    assert.ok(code.type === "code" && code.language === "ts" && code.text === "const a = 1 * 2 * 3;");
    const table = blocks[4];
    assert.ok(table.type === "table");
    assert.deepEqual(table.align, ["left", "right"]);
    assert.equal(table.rows.length, 1);
  });

  it("leaves unmatched markers, arithmetic, and snake_case as text", () => {
    assert.deepEqual(parseInline("2 * 3 * 4 and **half"), [{ type: "text", text: "2 * 3 * 4 and **half" }]);
    assert.deepEqual(parseInline("run snake_case_name now"), [{ type: "text", text: "run snake_case_name now" }]);
    assert.deepEqual(parseInline("\\*literal\\*"), [{ type: "text", text: "*literal*" }]);
    const nested = parseInline("*a **b** c*");
    assert.equal(nested.length, 1);
    assert.ok(nested[0].type === "em" && nested[0].children.some((node) => node.type === "strong"));
  });

  it("links bare URLs without the sentence's punctuation", () => {
    const nodes = parseInline("Lihat (https://example.com/a_(b)) dan https://example.com/x.");
    const links = nodes.filter((node) => node.type === "link");
    assert.deepEqual(links.map((node) => node.type === "link" && node.href), [
      "https://example.com/a_(b)",
      "https://example.com/x",
    ]);
    const code = parseInline("`https://example.com` stays code");
    assert.equal(code[0].type, "code");
  });

  it("only keeps web and mail links, and never nests them", () => {
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("data:text/html,hi"), null);
    assert.equal(safeHref("/relative"), null);
    assert.equal(safeHref("mailto:kana@example.com"), "mailto:kana@example.com");
    assert.deepEqual(parseInline("[click](javascript:alert(1))"), [{ type: "text", text: "click" }]);
    const [link] = parseInline("[https://a.example](https://b.example)");
    assert.ok(link.type === "link");
    assert.deepEqual(link.children, [{ type: "text", text: "https://a.example" }]);
    const [image] = parseInline("![chart](https://img.example/c.png)");
    assert.ok(image.type === "link" && image.href === "https://img.example/c.png");
  });

  it("turns single newlines into line breaks inside a paragraph", () => {
    const [paragraph] = parseMarkdown("line one\nline two");
    assert.ok(paragraph.type === "paragraph");
    assert.deepEqual(paragraph.children.map((node) => node.type), ["text", "break", "text"]);
  });
});
