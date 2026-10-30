import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "@/components/kana/chat-markdown";

function render(text: string, streaming = false): string {
  return renderToStaticMarkup(createElement(ChatMarkdown, { text, streaming }));
}

describe("streaming reply tip", () => {
  it("wraps only the newest characters in the fading span", () => {
    const html = render("0123456789ABCDEF", true);
    assert.match(
      html,
      /<p>0123<span class="kana-streaming-tail"><span class="kana-streaming-new">456789ABCDEF<\/span><\/span><\/p>/,
    );
  });

  it("adds no fading span to a finished reply", () => {
    const html = render("0123456789ABCDEF");
    assert.doesNotMatch(html, /kana-streaming-tail/);
  });

  it("keeps Markdown structure while fading the last text node", () => {
    const html = render("**bold** and the tail", true);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<span class="kana-streaming-tail"><span class="kana-streaming-new">and the tail<\/span><\/span>/);
  });

  it("fades the last list item's text", () => {
    const html = render("- first\n- the newest item", true);
    assert.match(html, /<span class="kana-streaming-tail"><span class="kana-streaming-new"> newest item<\/span><\/span>/);
    assert.match(html, /<li><p>first<\/p><\/li>/);
  });

  it("leaves a reply that ends in code without a fading span", () => {
    const html = render("Answer:\n\n```js\nconsole.log(1)\n```", true);
    assert.doesNotMatch(html, /kana-streaming-tail/);
  });
});

describe("chat code cards", () => {
  it("renders fenced code as a copyable card with its language", () => {
    const html = render("```html\n<p>hello</p>\n```");
    assert.match(html, /kana-chat-code/);
    assert.match(html, />html</);
    assert.match(html, /Copy code/);
    assert.match(html, /kana-code-tag/);
    assert.match(html, /&lt;p/);
  });

  it("offers no copy action on the provisional streaming bubble", () => {
    const html = render("```js\nconst x = 1;\n```", true);
    assert.match(html, /kana-chat-code/);
    assert.doesNotMatch(html, /Copy code/);
  });
});
